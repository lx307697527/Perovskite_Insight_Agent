"""
Stage2 Deep Extraction pipeline for SIA V2.1.

Orchestrates: Download → Parse → Smart Slice SI → AI Deep Extract → Save
Integrates with Stage1 screening data and stores markdown for QA engine reuse.
"""

import json
import datetime
import os
import uuid
import logging

from .pdf_engine import pdf_processor
from .crawler import crawler
from .database import SessionLocal, Literature, SIFile
from .prompts import PEROVSKITE_EXTRACTOR_PROMPT, SI_EXTRACTOR_PROMPT, STAGE2_DEEP_PROMPT
from .progress import create_tracker
from .qa_engine import invalidate_index
from .smart_slicer import slice_si

import openai

logger = logging.getLogger(__name__)

# Initialize OpenAI Client with a placeholder, will be updated by Settings
client = openai.AsyncOpenAI(api_key="placeholder")
current_model = "deepseek-chat"

# Directory to cache parsed markdown for QA reuse
_SIA_DIR = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
)
_MARKDOWN_CACHE_DIR = os.path.join(_SIA_DIR, "cache", "markdown")


class PaperExtractor:
    """
    Stage2 deep extraction pipeline.

    Stages: downloading → parsing → analyzing_si → extracting → saving
    """

    def _get_client(self):
        return client

    def update_config(self, config: dict):
        global client, current_model
        client = openai.AsyncOpenAI(
            api_key=config['apiKey'],
            base_url=config.get('stage2BaseUrl', config.get('baseUrl', 'https://api.deepseek.com'))
        )
        current_model = config.get('stage2Model', config.get('model', 'deepseek-chat'))
        logger.info(f"Extractor config updated: Model={current_model}")

    def _save_markdown_cache(self, doi: str, markdown: str, suffix: str = "main"):
        """Cache parsed markdown to disk for QA engine reuse."""
        os.makedirs(_MARKDOWN_CACHE_DIR, exist_ok=True)
        safe_doi = doi.replace('/', '_')
        path = os.path.join(_MARKDOWN_CACHE_DIR, f"{safe_doi}_{suffix}.md")
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(markdown)
        except Exception as e:
            logger.warning(f"Failed to cache markdown for {doi}: {e}")

    async def process_full_paper(self, doi: str, use_stage2_prompt: bool = True):
        """
        Stage2 deep extraction pipeline with 5-stage progress tracking.

        Stages: downloading → parsing → analyzing_si → extracting → saving
        """
        tracker = create_tracker(doi)
        tracker.define_stages([
            ("downloading", 0.20, "Downloading PDF"),
            ("parsing", 0.20, "Parsing document"),
            ("analyzing_si", 0.15, "Analyzing SI"),
            ("extracting", 0.35, "AI deep extraction"),
            ("saving", 0.10, "Saving results"),
        ])

        db = SessionLocal()
        try:
            # 1. Check Cache
            paper = db.query(Literature).filter(Literature.doi == doi).first()
            if paper and paper.is_extracted:
                yield {"status": "cached", "progress": 100, "timestamp": datetime.datetime.now().isoformat()}
                evidence_map = json.loads(paper.source_mapping) if paper.source_mapping else {}
                yield {"status": "completed", "result": self._format_result(paper, evidence_map), "progress": tracker.get_completed_event(), "timestamp": datetime.datetime.now().isoformat()}
                return

            # 2. Download
            tracker.start()
            tracker.advance("downloading")
            progress = tracker.get_progress()
            yield {"status": "downloading", "progress": progress, "timestamp": datetime.datetime.now().isoformat()}

            links = await crawler.get_pdf_links(doi)
            main_pdf, download_error = await crawler.download_file(links['main'], f"{doi.replace('/', '_')}.pdf")

            if not main_pdf:
                error_msg = download_error or "Unknown download error"
                raise Exception(f"Failed to download PDF: {error_msg}. The publisher may require authentication or the paper may not be open access.")

            # 3. Parse PDF to Markdown
            tracker.advance("parsing")
            progress = tracker.get_progress()
            yield {"status": "parsing", "progress": progress, "timestamp": datetime.datetime.now().isoformat()}

            markdown_content = await pdf_processor.convert_to_markdown(main_pdf)
            if not markdown_content:
                raise Exception("Failed to extract text from PDF. The file may be encrypted or corrupted.")

            # Cache markdown for QA engine
            self._save_markdown_cache(doi, markdown_content, "main")

            # Discover and download SI (Supplemental Information)
            si_markdown = ""
            si_file_path = None
            if links.get('si'):
                tracker.advance("analyzing_si")
                progress = tracker.get_progress()
                yield {"status": "analyzing_si", "progress": progress, "timestamp": datetime.datetime.now().isoformat()}

                si_pdf, si_error = await crawler.download_file(links['si'][0], f"{doi.replace('/', '_')}_SI.pdf")
                if si_pdf:
                    si_file_path = si_pdf
                    si_markdown = await pdf_processor.convert_to_markdown(si_pdf)
                    if si_markdown:
                        self._save_markdown_cache(doi, si_markdown, "si")

            # 4. AI Deep Extraction
            tracker.advance("extracting")
            progress = tracker.get_progress()
            yield {"status": "extracting", "progress": progress, "timestamp": datetime.datetime.now().isoformat()}

            # Choose prompt: Stage2 deep or legacy perovskite extractor
            extract_prompt = STAGE2_DEEP_PROMPT if use_stage2_prompt else PEROVSKITE_EXTRACTOR_PROMPT

            # Use smart_slicer to prepare content for extraction
            main_content = self._prepare_main_content(markdown_content)
            ai_data = await self._ai_extract(main_content, extract_prompt)

            # Analyze SI for Recipe using smart_slicer
            si_data = {}
            if si_markdown:
                si_chunks = self._prepare_si_content(si_markdown)
                if si_chunks:
                    si_data = await self._ai_extract(si_chunks, SI_EXTRACTOR_PROMPT)

            # 5. Save to DB
            tracker.advance("saving")
            progress = tracker.get_progress()
            yield {"status": "extracting", "progress": progress, "timestamp": datetime.datetime.now().isoformat()}

            try:
                metrics = ai_data.get('metrics', [])

                def get_metric(field):
                    item = next((m for m in metrics if m.get('field') == field), {})
                    val = item.get('value', 'N/A')
                    evidence = item.get('evidence', 'Extracted from paper text.')
                    return self._normalize_metric(field, val), evidence

                pce_val, pce_ev = get_metric('PCE')
                voc_val, voc_ev = get_metric('Voc')
                jsc_val, jsc_ev = get_metric('Jsc')
                ff_val, ff_ev = get_metric('FF')

                evidence_map = {
                    "PCE": pce_ev,
                    "Voc": voc_ev,
                    "Jsc": jsc_ev,
                    "FF": ff_ev
                }

                performance_data = {
                    "pce": pce_val, "voc": voc_val,
                    "jsc": jsc_val, "ff": ff_val,
                }

                # Add device_type and stability from Stage2 extraction
                if ai_data.get('device_type'):
                    performance_data['device_type'] = ai_data['device_type']
                if ai_data.get('stability'):
                    performance_data['stability'] = ai_data['stability']
                if ai_data.get('active_area'):
                    performance_data['active_area'] = ai_data['active_area']

                # Preserve Stage1 screening data in source_mapping
                existing_mapping = {}
                try:
                    existing_mapping = json.loads(paper.source_mapping) if paper and paper.source_mapping else {}
                except Exception:
                    pass
                existing_mapping.update(evidence_map)
                if ai_data.get('stability'):
                    existing_mapping['stability_evidence'] = ai_data['stability'].get('evidence', '')

                # Build SI paths list for QA engine
                si_paths_list = []
                if si_file_path:
                    si_paths_list.append(si_file_path)

                if not paper:
                    paper = Literature(
                        doi=doi,
                        title=f"Auto-extracted {doi}",
                        is_extracted=True,
                        extraction_stage="stage2",
                        data_source="fulltext",
                        composition=ai_data.get('composition', 'Unknown'),
                        structure=ai_data.get('structure', 'Unknown'),
                        source_mapping=json.dumps(existing_mapping),
                        performance_data=json.dumps(performance_data),
                        process_params=json.dumps(si_data) if si_data else json.dumps(ai_data.get('process', [])),
                        local_pdf_path=main_pdf,
                        si_paths=json.dumps(si_paths_list) if si_paths_list else None,
                        quality_flag="OK",
                    )
                    db.add(paper)
                else:
                    paper.is_extracted = True
                    paper.extraction_stage = "stage2"
                    paper.data_source = "fulltext"
                    paper.composition = ai_data.get('composition', 'Unknown')
                    paper.structure = ai_data.get('structure', 'Unknown')
                    paper.source_mapping = json.dumps(existing_mapping)
                    paper.performance_data = json.dumps(performance_data)
                    paper.process_params = json.dumps(si_data) if si_data else json.dumps(ai_data.get('process', []))
                    paper.local_pdf_path = main_pdf
                    paper.si_paths = json.dumps(si_paths_list) if si_paths_list else None
                    paper.quality_flag = "OK"

                db.commit()
                db.refresh(paper)

                # Track SI file in DB for QA engine
                if si_file_path:
                    self._track_si_file(db, doi, si_file_path, links.get('si', [''])[0])

                # Invalidate any cached Q&A index since data changed
                invalidate_index(doi)

                yield {"status": "completed", "progress": tracker.get_completed_event(), "result": self._format_result(paper, existing_mapping, si_data), "timestamp": datetime.datetime.now().isoformat()}

            except Exception as e:
                db.rollback()
                yield {"status": "failed", "error": str(e), "timestamp": datetime.datetime.now().isoformat()}
                raise

        except Exception as e:
            logger.error(f"Extraction failed for {doi}: {e}")
            try:
                paper = db.query(Literature).filter(Literature.doi == doi).first()
                if paper:
                    paper.extraction_stage = "failed"
                    db.commit()
            except Exception:
                db.rollback()
            yield {"status": "failed", "error": str(e), "timestamp": datetime.datetime.now().isoformat()}
        finally:
            db.close()

    def _track_si_file(self, db, doi: str, file_path: str, url: str):
        """Create or update SIFile record for QA engine to find."""
        try:
            existing = db.query(SIFile).filter(
                SIFile.literature_doi == doi,
                SIFile.local_path == file_path,
            ).first()
            if not existing:
                si_file = SIFile(
                    id=str(uuid.uuid4()),
                    literature_doi=doi,
                    url=url,
                    type="pdf",
                    status="ready",
                    local_path=file_path,
                )
                db.add(si_file)
                db.commit()
        except Exception as e:
            logger.warning(f"Failed to track SI file: {e}")
            db.rollback()

    def _prepare_main_content(self, markdown: str) -> str:
        """Prepare main text content for AI extraction.

        Uses smart_slicer-like logic to find the most relevant sections
        (experimental/methods), falling back to first 30K chars.
        """
        if not markdown:
            return ""

        content_lower = markdown.lower()
        start_idx = content_lower.find("experimental")
        if start_idx == -1:
            start_idx = content_lower.find("method")

        if start_idx != -1:
            # Include 500 chars before the anchor for context
            return markdown[max(0, start_idx - 500):start_idx + 30000]

        return markdown[:30000]

    def _prepare_si_content(self, si_markdown: str) -> str:
        """Prepare SI content for AI extraction using smart_slicer.

        Returns the most relevant SI chunks (experimental sections + tables).
        """
        if not si_markdown:
            return ""

        slices = slice_si(si_markdown, max_chunk_tokens=4000, overlap_tokens=200)
        if not slices:
            return si_markdown[:30000]

        # Combine the most relevant slices, up to ~30K chars
        parts = []
        total_len = 0
        for s in slices:
            if total_len + len(s.content) > 30000:
                # Truncate last chunk to fit
                remaining = 30000 - total_len
                if remaining > 500:
                    parts.append(s.content[:remaining])
                break
            parts.append(s.content)
            total_len += len(s.content)

        return "\n\n---\n\n".join(parts)

    async def process_local_pdf(self, file_path: str, doi: str | None = None):
        """
        Processes a PDF file directly from a local path.
        If doi is provided, saves extraction results to DB so the details page
        can reflect the updated state.
        """
        db = SessionLocal()
        try:
            filename = os.path.basename(file_path)
            logger.info(f"Starting local PDF processing for: {filename}")
            yield {"status": "parsing", "progress": 20, "timestamp": datetime.datetime.now().isoformat()}

            # 1. Parse PDF
            markdown_content = await pdf_processor.convert_to_markdown(file_path)

            if not markdown_content:
                yield {"status": "failed", "error": "PDF解析失败，无法提取文本内容", "timestamp": datetime.datetime.now().isoformat()}
                return

            # Cache markdown — use DOI if available for consistent cache key
            cache_key = doi or f"local_{os.path.splitext(filename)[0]}"
            self._save_markdown_cache(cache_key, markdown_content, "main")

            yield {"status": "extracting", "progress": 50, "timestamp": datetime.datetime.now().isoformat()}

            # 2. AI Extraction — use smart content preparation
            main_content = self._prepare_main_content(markdown_content)
            ai_data = await self._ai_extract(main_content, PEROVSKITE_EXTRACTOR_PROMPT)

            # 3. Save to DB if DOI provided
            if doi:
                try:
                    metrics = ai_data.get('metrics', [])

                    def get_metric(field):
                        item = next((m for m in metrics if m.get('field') == field), {})
                        val = item.get('value', 'N/A')
                        evidence = item.get('evidence', 'Extracted from paper text.')
                        return self._normalize_metric(field, val), evidence

                    pce_val, pce_ev = get_metric('PCE')
                    voc_val, voc_ev = get_metric('Voc')
                    jsc_val, jsc_ev = get_metric('Jsc')
                    ff_val, ff_ev = get_metric('FF')

                    evidence_map = {"PCE": pce_ev, "Voc": voc_ev, "Jsc": jsc_ev, "FF": ff_ev}
                    performance_data = {"pce": pce_val, "voc": voc_val, "jsc": jsc_val, "ff": ff_val}
                    if ai_data.get('device_type'):
                        performance_data['device_type'] = ai_data['device_type']

                    paper = db.query(Literature).filter(Literature.doi == doi).first()
                    process_data = ai_data.get('process', [])

                    if not paper:
                        paper = Literature(
                            doi=doi,
                            title=filename,
                            is_extracted=True,
                            extraction_stage="stage2",
                            data_source="fulltext",
                            composition=ai_data.get('composition', 'Unknown'),
                            structure=ai_data.get('structure', 'Unknown'),
                            source_mapping=json.dumps(evidence_map),
                            performance_data=json.dumps(performance_data),
                            process_params=json.dumps(process_data) if process_data else None,
                            local_pdf_path=file_path,
                            quality_flag="OK",
                        )
                        db.add(paper)
                    else:
                        paper.is_extracted = True
                        paper.extraction_stage = "stage2"
                        paper.data_source = "fulltext"
                        paper.composition = ai_data.get('composition', 'Unknown')
                        paper.structure = ai_data.get('structure', 'Unknown')
                        paper.source_mapping = json.dumps(evidence_map)
                        paper.performance_data = json.dumps(performance_data)
                        paper.process_params = json.dumps(process_data) if process_data else paper.process_params
                        paper.local_pdf_path = file_path
                        paper.quality_flag = "OK"

                    db.commit()
                    db.refresh(paper)
                    invalidate_index(doi)
                except Exception as e:
                    db.rollback()
                    logger.error(f"Failed to save local PDF extraction to DB for {doi}: {e}")

            yield {"status": "completed", "result": {
                "doi": doi or ai_data.get("doi", "local_file"),
                "title": filename,
                "device_type": ai_data.get("device_type", "solar_cell"),
                "metrics": ai_data.get("metrics", []),
                "composition": ai_data.get('composition', 'Unknown'),
                "structure": ai_data.get('structure', 'Unknown'),
                "process": ai_data.get('process', []),
                "process_summary": ai_data.get('process_summary', ''),
                "quality": "good",
                "qualityText": "本地文件解析完成"
            }, "timestamp": datetime.datetime.now().isoformat()}
        except Exception as e:
            logger.error(f"Local PDF error: {e}")
            yield {"status": "error", "message": str(e), "timestamp": datetime.datetime.now().isoformat()}
        finally:
            db.close()

    async def _ai_extract(self, content: str, prompt: str) -> dict:
        skeleton = {
            "metrics": [],
            "composition": "Unknown",
            "structure": "Unknown",
            "process": [],
            "process_summary": "",
            "recipe": {},
            "stability": None,
            "active_area": None,
        }
        try:
            if not content:
                logger.warning("_ai_extract received empty content")
                return skeleton

            # Escape curly braces to prevent format string issues
            safe_content = content.replace('{', '{{').replace('}', '}}')
            formatted_prompt = prompt.replace('{content}', safe_content)

            logger.info(f"Sending prompt to AI, content length: {len(safe_content)}")

            response = await self._get_client().chat.completions.create(
                model=current_model,
                messages=[
                    {"role": "system", "content": "You are a professional scientific data extractor. Always return PURE JSON without markdown code blocks."},
                    {"role": "user", "content": formatted_prompt}
                ],
                timeout=60.0
            )
            raw_content = response.choices[0].message.content

            if not raw_content:
                logger.warning("AI returned empty response")
                return skeleton

            logger.debug(f"AI raw response (first 500 chars): {raw_content[:500]}")

            # Robust JSON cleaning
            cleaned_json = raw_content.strip()

            if cleaned_json.startswith("```json"):
                cleaned_json = cleaned_json[7:]
            elif cleaned_json.startswith("```"):
                cleaned_json = cleaned_json[3:]
            if cleaned_json.endswith("```"):
                cleaned_json = cleaned_json[:-3]
            cleaned_json = cleaned_json.strip()

            import re
            json_match = re.search(r'\{[\s\S]*\}', cleaned_json)
            if json_match:
                cleaned_json = json_match.group(0)

            data = json.loads(cleaned_json)

            # Ensure essential keys exist
            for key in skeleton:
                if key not in data:
                    data[key] = skeleton[key]
            return data
        except Exception as e:
            logger.error(f"AI API Error: {e}")
            return skeleton

    def _format_result(self, paper, evidence_map, si_data=None):
        perf = json.loads(paper.performance_data) if paper.performance_data else {}
        return {
            "doi": paper.doi,
            "title": paper.title,
            "device_type": perf.get("device_type", "solar_cell"),
            "metrics": {
                "pce": {"value": perf.get("pce", "N/A"), "unit": "%", "evidence": evidence_map.get("PCE")},
                "voc": {"value": perf.get("voc", "N/A"), "unit": "V", "evidence": evidence_map.get("Voc")},
                "jsc": {"value": perf.get("jsc", "N/A"), "unit": "mA/cm²", "evidence": evidence_map.get("Jsc")},
                "ff": {"value": perf.get("ff", "N/A"), "unit": "%", "evidence": evidence_map.get("FF")}
            },
            "composition": paper.composition or "Unknown",
            "structure": paper.structure or "Unknown",
            "stability": perf.get("stability"),
            "active_area": perf.get("active_area"),
            "recipe": si_data,
            "quality": paper.quality_flag or "good",
            "qualityText": "主文与 SI 已联合解析" if si_data else "主文深度解析完成"
        }

    def _normalize_metric(self, field: str, value: str) -> str:
        """
        Normalizes scientific units (e.g., mV -> V)
        """
        if not value or value == "N/A": return "N/A"

        import re
        val_match = re.search(r"([-+]?\d*\.\d+|\d+)", value)
        if not val_match: return value

        num = float(val_match.group(1))

        if field == "Voc":
            if "mv" in value.lower() or (num > 10 and "v" not in value.lower()):
                return f"{num/1000:.3f}"
            return f"{num:.3f}"

        if field == "PCE" or field == "FF":
            if num < 1:
                return f"{num*100:.1f}"
            return f"{num:.1f}"

        return f"{num:.2f}"


extractor = PaperExtractor()
