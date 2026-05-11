"""
Stage 1 Lightweight Abstract Screening for SIA V2.1.

Quick, low-cost analysis (~$0.001/paper, ~2s) that:
1. Reads paper abstract (or first N chars of full text)
2. Classifies relevance and device type
3. Extracts headline metrics
4. Decides whether Stage 2 deep extraction is worthwhile

Yields SSE progress events for integration with the extract API.
"""

import json
import datetime
import logging
from typing import Optional

import openai

from .database import SessionLocal, Literature
from .progress import create_tracker

logger = logging.getLogger(__name__)

STAGE1_PROMPT = """You are a scientific paper relevance screener. Analyze the following paper abstract/metadata and determine if it contains extractable experimental data for perovskite or semiconductor devices.

### Criteria for relevance:
1. The paper must describe actual experimental devices (not purely theoretical/computational)
2. It must contain quantitative performance metrics (efficiency, sensitivity, etc.)
3. It should be about perovskite, semiconductor, or related functional materials

### Output Format (Strict JSON):
{
  "is_relevant": true/false,
  "relevance_score": 0.0-1.0,
  "device_type": "solar_cell | xray_detector | photodetector | led | other | unknown",
  "reason": "Brief explanation of why this paper is or isn't relevant",
  "key_findings": "One sentence summary of the main experimental result, if any",
  "headline_metrics": {"PCE": "24.9%", ...},
  "composition": "e.g., Cs0.05FA0.85MA0.1PbI3",
  "recommendation": "proceed | skip",
  "summary": "One-sentence paper summary"
}

### Paper Content:
{content}
"""


class Stage1Screener:
    """Lightweight screening to filter relevant papers before deep extraction."""

    def __init__(self):
        self._client: Optional[openai.AsyncOpenAI] = None
        self._model = "deepseek-chat"

    def update_config(self, config: dict):
        self._client = openai.AsyncOpenAI(
            api_key=config["apiKey"],
            base_url=config.get("stage1BaseUrl", config.get("baseUrl", "https://api.deepseek.com")),
        )
        self._model = config.get("stage1Model", config.get("model", "deepseek-chat"))
        logger.info(f"Stage1 config updated: model={self._model}")

    async def screen(self, content: str) -> dict:
        """Screen a paper for relevance. Returns screening result dict."""
        default_result = {
            "is_relevant": True,
            "relevance_score": 0.5,
            "device_type": "unknown",
            "reason": "Screening skipped",
            "key_findings": "",
            "headline_metrics": {},
            "composition": "",
            "recommendation": "proceed",
            "summary": "",
        }

        if not self._client:
            return default_result

        if not content or len(content.strip()) < 50:
            return default_result

        try:
            truncated = content[:3000]
            safe_content = truncated.replace("{", "{{").replace("}", "}}")
            prompt = STAGE1_PROMPT.replace("{content}", safe_content)

            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": "You are a paper relevance screener. Return PURE JSON."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=400,
                timeout=15.0,
            )

            raw = response.choices[0].message.content or ""
            cleaned = raw.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            elif cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

            import re
            json_match = re.search(r"\{[\s\S]*\}", cleaned)
            if json_match:
                cleaned = json_match.group(0)

            result = json.loads(cleaned)
            for key in default_result:
                if key not in result:
                    result[key] = default_result[key]

            return result

        except Exception as e:
            logger.warning(f"Stage1 screening failed: {e}")
            return default_result

    async def screen_paper(self, doi: str):
        """Run Stage1 screening on a paper with SSE progress events.

        Yields SSE event dicts with status/progress/result fields.
        """
        tracker = create_tracker(doi)
        tracker.define_stages([
            ("fetch", 0.3, "Fetching paper info"),
            ("analyze", 0.5, "AI analyzing abstract"),
            ("save", 0.2, "Saving screening result"),
        ])

        db = SessionLocal()
        try:
            tracker.start()

            # Step 1: Fetch paper info
            tracker.advance("fetch")
            yield {
                "status": "screening",
                "progress": tracker.get_progress(),
                "timestamp": datetime.datetime.now().isoformat(),
            }

            lit = db.query(Literature).filter(Literature.doi == doi).first()
            if not lit:
                yield {
                    "status": "failed",
                    "error": f"Paper {doi} not found in database",
                    "timestamp": datetime.datetime.now().isoformat(),
                }
                return

            # Gather input text
            input_text = lit.abstract or ""
            if not input_text and lit.performance_data:
                try:
                    perf = json.loads(lit.performance_data)
                    input_text = f"Performance data: {json.dumps(perf)}"
                except Exception:
                    pass
            if not input_text:
                input_text = lit.title or "No content available"

            # Already screened?
            if lit.extraction_stage == "stage1" and lit.relevance_score is not None:
                yield {
                    "status": "completed",
                    "result": self._format_screening_result(lit),
                    "progress": tracker.get_completed_event(),
                    "timestamp": datetime.datetime.now().isoformat(),
                }
                return

            # Step 2: AI analyze
            tracker.advance("analyze")
            yield {
                "status": "screening",
                "progress": tracker.get_progress(),
                "timestamp": datetime.datetime.now().isoformat(),
            }

            screening_data = await self.screen(input_text)

            # Step 3: Save result
            tracker.advance("save")
            yield {
                "status": "screening",
                "progress": tracker.get_progress(),
                "timestamp": datetime.datetime.now().isoformat(),
            }

            # Update literature record
            lit.extraction_stage = "stage1"
            lit.data_source = "abstract"
            lit.relevance_score = screening_data.get("relevance_score", 0.5)

            if screening_data.get("device_type") and screening_data["device_type"] != "unknown":
                if not lit.performance_data or lit.performance_data == "{}":
                    lit.performance_data = json.dumps({
                        "device_type": screening_data["device_type"],
                        "headline_metrics": screening_data.get("headline_metrics", {}),
                    })

            if screening_data.get("composition"):
                existing_mapping = {}
                try:
                    existing_mapping = json.loads(lit.source_mapping) if lit.source_mapping else {}
                except Exception:
                    pass
                existing_mapping["stage1_composition"] = screening_data["composition"]
                existing_mapping["stage1_summary"] = screening_data.get("summary", "")
                existing_mapping["stage1_reason"] = screening_data.get("reason", "")
                lit.source_mapping = json.dumps(existing_mapping)

            # Set quality flag based on relevance
            if screening_data.get("is_relevant", True):
                lit.quality_flag = "OK"
            else:
                lit.quality_flag = "WARNING"

            db.commit()
            db.refresh(lit)

            yield {
                "status": "completed",
                "result": self._format_screening_result(lit, screening_data),
                "progress": tracker.get_completed_event(),
                "timestamp": datetime.datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Stage1 screening pipeline failed for {doi}: {e}")
            try:
                lit = db.query(Literature).filter(Literature.doi == doi).first()
                if lit:
                    lit.extraction_stage = "failed"
                    db.commit()
            except Exception:
                db.rollback()
            yield {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat(),
            }
        finally:
            db.close()

    def _format_screening_result(self, lit: Literature, screening_data: dict = None) -> dict:
        """Format screening result for SSE response."""
        result = {
            "doi": lit.doi,
            "title": lit.title,
            "is_relevant": True,
            "relevance_score": lit.relevance_score or 0.5,
            "device_type": "unknown",
            "headline_metrics": {},
            "recommendation": "proceed",
            "summary": "",
            "reason": "",
            "extraction_stage": lit.extraction_stage,
        }

        if screening_data:
            result.update({
                "is_relevant": screening_data.get("is_relevant", True),
                "device_type": screening_data.get("device_type", "unknown"),
                "headline_metrics": screening_data.get("headline_metrics", {}),
                "recommendation": screening_data.get("recommendation", "proceed"),
                "summary": screening_data.get("summary", ""),
                "reason": screening_data.get("reason", ""),
            })
        else:
            # Reconstruct from DB
            if lit.source_mapping:
                try:
                    mapping = json.loads(lit.source_mapping)
                    result["summary"] = mapping.get("stage1_summary", "")
                    result["composition"] = mapping.get("stage1_composition", "")
                    result["reason"] = mapping.get("stage1_reason", "")
                except Exception:
                    pass

            if lit.performance_data:
                try:
                    perf = json.loads(lit.performance_data)
                    result["device_type"] = perf.get("device_type", "unknown")
                    result["headline_metrics"] = perf.get("headline_metrics", {})
                except Exception:
                    pass

        return result


# Singleton
stage1_screener = Stage1Screener()
