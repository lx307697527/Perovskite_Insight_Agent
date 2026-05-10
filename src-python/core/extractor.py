import json
import datetime
from .pdf_engine import pdf_processor
from .crawler import crawler
from .database import SessionLocal, Literature
from .prompts import PEROVSKITE_EXTRACTOR_PROMPT, SI_EXTRACTOR_PROMPT
import openai
import os

# Initialize OpenAI Client with a placeholder, will be updated by Settings
client = openai.AsyncOpenAI(api_key="placeholder")
current_model = "deepseek-chat"

class PaperExtractor:
    """
    Orchestrates the full extraction workflow:
    Download -> Parse -> AI Extract -> Save
    """
    
    def _get_client(self):
        return client

    def update_config(self, config: dict):
        global client, current_model
        client = openai.AsyncOpenAI(
            api_key=config['apiKey'],
            base_url=config['baseUrl']
        )
        current_model = config['model']
        print(f"Backend config updated: Model={current_model}, BaseURL={config['baseUrl']}")

    async def process_full_paper(self, doi: str):
        """
        The main pipeline triggered by the 'Extract' button
        """
        db = SessionLocal()
        try:
            # 1. Check Cache
            paper = db.query(Literature).filter(Literature.doi == doi).first()
            if paper and paper.is_extracted:
                yield {"status": "cached", "progress": 100, "timestamp": datetime.datetime.now().isoformat()}
                evidence_map = json.loads(paper.source_mapping) if paper.source_mapping else {}
                yield {"status": "completed", "result": self._format_result(paper, evidence_map), "timestamp": datetime.datetime.now().isoformat()}
                return

            # 2. Download (Progress 0-30%)
            yield {"status": "downloading", "progress": 10, "timestamp": datetime.datetime.now().isoformat()}
            links = await crawler.get_pdf_links(doi)
            main_pdf, download_error = await crawler.download_file(links['main'], f"{doi.replace('/', '_')}.pdf")
            yield {"status": "downloading", "progress": 30, "timestamp": datetime.datetime.now().isoformat()}

            # 3. Parse PDF to Markdown (Progress 30-50%)
            yield {"status": "parsing", "progress": 35, "timestamp": datetime.datetime.now().isoformat()}
            if not main_pdf:
                error_msg = download_error or "Unknown download error"
                raise Exception(f"Failed to download PDF: {error_msg}. The publisher may require authentication or the paper may not be open access.")
            markdown_content = await pdf_processor.convert_to_markdown(main_pdf)
            if not markdown_content:
                raise Exception("Failed to extract text from PDF. The file may be encrypted or corrupted.")

            # Discovery SI (Supplemental Information)
            si_markdown = ""
            if links.get('si'):
                yield {"status": "analyzing_si", "progress": 45, "timestamp": datetime.datetime.now().isoformat()}
                si_pdf, si_error = await crawler.download_file(links['si'][0], f"{doi.replace('/', '_')}_SI.pdf")
                if si_pdf:
                    si_markdown = await pdf_processor.convert_to_markdown(si_pdf)

            yield {"status": "parsing", "progress": 55, "timestamp": datetime.datetime.now().isoformat()}

            # 4. AI Extraction (Progress 55-95%)
            yield {"status": "extracting", "progress": 65, "timestamp": datetime.datetime.now().isoformat()}

            # Analyze Main Paper
            ai_data = await self._ai_extract(markdown_content, PEROVSKITE_EXTRACTOR_PROMPT)

            # Analyze SI for Recipe (If available)
            si_data = {}
            if si_markdown:
                yield {"status": "extracting", "progress": 85, "timestamp": datetime.datetime.now().isoformat()}
                si_data = await self._ai_extract(si_markdown, SI_EXTRACTOR_PROMPT)

            yield {"status": "extracting", "progress": 95, "timestamp": datetime.datetime.now().isoformat()}

            # 5. Save to DB (with transaction)
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

                if not paper:
                    paper = Literature(
                        doi=doi,
                        title=f"Auto-extracted {doi}",
                        is_extracted=True,
                        extraction_stage="stage2",
                        data_source="fulltext",
                        composition=ai_data.get('composition', 'Unknown'),
                        structure=ai_data.get('structure', 'Unknown'),
                        source_mapping=json.dumps(evidence_map),
                        performance_data=json.dumps(performance_data),
                        process_params=json.dumps(si_data),
                        local_pdf_path=main_pdf,
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
                    paper.process_params = json.dumps(si_data)
                    paper.local_pdf_path = main_pdf

                db.commit()
                db.refresh(paper)

                yield {"status": "completed", "progress": 100, "result": self._format_result(paper, evidence_map, si_data), "timestamp": datetime.datetime.now().isoformat()}

            except Exception as e:
                db.rollback()
                yield {"status": "failed", "error": str(e), "timestamp": datetime.datetime.now().isoformat()}
                raise

        finally:
            db.close()

    async def process_local_pdf(self, file_path: str):
        """
        Processes a PDF file directly from a local path
        """
        db = SessionLocal()
        try:
            filename = os.path.basename(file_path)
            print(f"DEBUG: Starting local PDF processing for: {filename}")
            yield {"status": "parsing", "progress": 20, "timestamp": datetime.datetime.now().isoformat()}

            # 1. Parse PDF
            print(f"DEBUG: Converting PDF to markdown...")
            markdown_content = await pdf_processor.convert_to_markdown(file_path)
            print(f"DEBUG: PDF conversion complete, content length: {len(markdown_content) if markdown_content else 0}")

            if not markdown_content:
                yield {"status": "failed", "error": "PDF解析失败，无法提取文本内容", "timestamp": datetime.datetime.now().isoformat()}
                return

            yield {"status": "extracting", "progress": 50, "timestamp": datetime.datetime.now().isoformat()}

            # 2. AI Extraction
            print(f"DEBUG: Starting AI extraction...")
            ai_data = await self._ai_extract(markdown_content, PEROVSKITE_EXTRACTOR_PROMPT)
            print(f"DEBUG: AI extraction complete: {ai_data}")

            yield {"status": "completed", "result": {
                "doi": ai_data.get("doi", "local_file"),
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
            print(f"Local PDF error: {e}")
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
            "recipe": {}
        }
        try:
            if not content:
                print("Warning: _ai_extract received empty content")
                return skeleton

            # Smart Slicing
            content_lower = content.lower()
            start_idx = content_lower.find("experimental")
            if start_idx == -1:
                start_idx = content_lower.find("method")

            processed_content = content[max(0, start_idx-500):start_idx+30000] if start_idx != -1 else content[:30000]

            # Escape curly braces to prevent format string issues
            safe_content = processed_content.replace('{', '{{').replace('}', '}}')
            # Then replace only our placeholder
            formatted_prompt = prompt.replace('{content}', safe_content)

            print(f"DEBUG: Sending prompt to AI, content length: {len(safe_content)}")

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
                print("Warning: AI returned empty response")
                return skeleton

            print(f"DEBUG: AI raw response (first 800 chars):\n{raw_content[:800]}")

            # Robust JSON cleaning
            cleaned_json = raw_content.strip()

            # Remove markdown code blocks if present
            if cleaned_json.startswith("```json"):
                cleaned_json = cleaned_json[7:]
            elif cleaned_json.startswith("```"):
                cleaned_json = cleaned_json[3:]
            if cleaned_json.endswith("```"):
                cleaned_json = cleaned_json[:-3]
            cleaned_json = cleaned_json.strip()

            print(f"DEBUG: Cleaned JSON (first 500 chars):\n{cleaned_json[:500]}")

            # Try to extract JSON object if there's extra text
            import re
            json_match = re.search(r'\{[\s\S]*\}', cleaned_json)
            if json_match:
                cleaned_json = json_match.group(0)
                print(f"DEBUG: Extracted JSON length: {len(cleaned_json)}")

            try:
                data = json.loads(cleaned_json)
            except json.JSONDecodeError as je:
                print(f"DEBUG: JSON decode error at position {je.pos}: {je.msg}")
                print(f"DEBUG: Failed JSON content around error: {cleaned_json[max(0, je.pos-50):je.pos+50]}")
                raise
            # Ensure essential keys exist
            for key in skeleton:
                if key not in data:
                    data[key] = skeleton[key]
            return data
        except Exception as e:
            print(f"AI API Error Detail: {e}")
            return skeleton

    def _format_result(self, paper, evidence_map, si_data=None):
        perf = json.loads(paper.performance_data) if paper.performance_data else {}
        return {
            "doi": paper.doi,
            "title": paper.title,
            "metrics": {
                "pce": {"value": perf.get("pce", "N/A"), "unit": "%", "evidence": evidence_map.get("PCE")},
                "voc": {"value": perf.get("voc", "N/A"), "unit": "V", "evidence": evidence_map.get("Voc")},
                "jsc": {"value": perf.get("jsc", "N/A"), "unit": "mA/cm²", "evidence": evidence_map.get("Jsc")},
                "ff": {"value": perf.get("ff", "N/A"), "unit": "%", "evidence": evidence_map.get("FF")}
            },
            "composition": paper.composition or "Unknown",
            "structure": paper.structure or "Unknown",
            "recipe": si_data,
            "quality": "good",
            "qualityText": "主文与 SI 已联合解析"
        }

    def _normalize_metric(self, field: str, value: str) -> str:
        """
        Normalizes scientific units (e.g., mV -> V)
        """
        if not value or value == "N/A": return "N/A"
        
        # Remove units for numerical normalization if possible
        import re
        val_match = re.search(r"([-+]?\d*\.\d+|\d+)", value)
        if not val_match: return value
        
        num = float(val_match.group(1))
        
        if field == "Voc":
            # Convert mV to V
            if "mv" in value.lower() or (num > 10 and "v" not in value.lower()):
                return f"{num/1000:.3f}"
            return f"{num:.3f}"
        
        if field == "PCE" or field == "FF":
            # Ensure percentage format
            if num < 1: # Already a decimal?
                return f"{num*100:.1f}"
            return f"{num:.1f}"
            
        return f"{num:.2f}"

extractor = PaperExtractor()
