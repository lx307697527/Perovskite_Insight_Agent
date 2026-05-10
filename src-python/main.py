"""
SIA (Sci-Insight Agent) API — FastAPI entry point.
Slim orchestrator that mounts V2.1 API sub-modules and retains V1 backward-compat routes.
"""

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
import asyncio
import json
import os
import datetime
import re
from pathlib import Path

# Internal imports
from core.extractor import extractor
from core.database import init_db, SessionLocal, Paper, migrate_v1_data
from core.exporter import exporter
from core.crawler import crawler
from core.translator import translator
from core.security import decrypt_settings, encrypt_settings, needs_migration, migrate_from_plaintext
from core.model_manager import start_background_load

# ============================================================
# App bootstrap
# ============================================================
app = FastAPI(title="Sci-Insight Agent API")

init_db()

# One-time V1 → V2 data migration
migrate_v1_data()

# Migrate plaintext config to encrypted settings
if needs_migration():
    migrate_from_plaintext()

# Load config (prefer encrypted, fallback to legacy config.json)
current_config = decrypt_settings()
if not current_config:
    # Fallback: try legacy config.json
    _LEGACY_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    if os.path.exists(_LEGACY_CONFIG):
        with open(_LEGACY_CONFIG, "r") as f:
            current_config = json.load(f)
    else:
        current_config = {
            "apiKey": "",
            "baseUrl": "https://api.deepseek.com",
            "model": "deepseek-chat"
        }

extractor.update_config(current_config)
translator.update_config(current_config)

# Start embedding model background loading
start_background_load()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Mount V2.1 API sub-modules
# ============================================================
from api.config import router as config_router
from api.search import router as search_router
from api.projects import router as projects_router
from api.literature import router as literature_router
from api.extract import router as extract_router
from api.qa import router as qa_router
from api.chat import router as chat_router
from api.compare import router as compare_router

app.include_router(config_router)
app.include_router(search_router)
app.include_router(projects_router)
app.include_router(literature_router)
app.include_router(extract_router)
app.include_router(qa_router)
app.include_router(chat_router)
app.include_router(compare_router)

# ============================================================
# V1 backward-compatible routes (retained during migration)
# ============================================================
from pydantic import BaseModel


class Config(BaseModel):
    apiKey: str
    baseUrl: str
    model: str


active_extractions = set()

DOI_PATTERN = re.compile(r'^10\.\d{4,9}/[-._;()/:A-Z0-9]+$', re.IGNORECASE)


def validate_doi(doi: str) -> bool:
    return bool(DOI_PATTERN.match(doi))


def validate_file_path(file_path: str) -> Path:
    path = Path(file_path).resolve()
    allowed_dir = Path(os.environ.get('APPDATA', os.path.expanduser('~'))) / 'SIA' / 'downloads'
    try:
        path.relative_to(allowed_dir)
        return path
    except ValueError:
        # Also allow legacy PIA_Agent path during migration
        legacy_dir = Path(os.environ.get('APPDATA', os.path.expanduser('~'))) / 'PIA_Agent' / 'downloads'
        try:
            path.relative_to(legacy_dir)
            return path
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: file path outside allowed directory")


@app.get("/")
async def root():
    return {"status": "ok", "message": "SIA Backend Sidecar is running"}


@app.post("/api/settings")
async def update_settings(config: Config):
    global current_config
    try:
        new_config = config.dict()
        current_config.update(new_config)
        encrypt_settings(current_config)
        extractor.update_config(current_config)
        translator.update_config(current_config)
        return {"success": True, "data": {"message": "Settings updated"}}
    except Exception as e:
        print(f"ERROR: Failed to update settings: {str(e)}")
        return {"success": False, "error": str(e)}


@app.get("/api/paper/{doi:path}")
async def get_paper_details(doi: str):
    """Fetches full paper details and extraction results for the details page."""
    if doi.startswith("upload_"):
        if doi not in upload_results:
            if doi in upload_status and upload_status[doi].get("status") == "completed":
                upload_results[doi] = upload_status[doi].get("result", {})
            else:
                raise HTTPException(status_code=404, detail="Upload result not found or extraction incomplete")

        result_data = upload_results[doi]
        metrics = result_data.get("metrics", [])
        process = result_data.get("process", [])

        formatted_metrics = []
        if isinstance(metrics, list):
            for m in metrics:
                formatted_metrics.append({
                    "label": m.get("field", "Unknown"),
                    "value": m.get("value", "N/A"),
                    "unit": "",
                    "evidence": m.get("evidence", ""),
                    "condition": m.get("condition", "")
                })

        formatted_process = []
        if isinstance(process, list):
            for p in process:
                formatted_process.append({
                    "field": p.get("field", "Unknown"),
                    "value": p.get("value", "N/A"),
                    "source": p.get("source", "main"),
                    "evidence": p.get("evidence", "")
                })

        return {
            "success": True,
            "data": {
                "title": result_data.get("title", "Uploaded PDF"),
                "journal": "Local File",
                "year": 2024,
                "authors": "Uploaded by user",
                "abstract": result_data.get("process_summary", "No abstract available for uploaded files."),
                "metrics": formatted_metrics,
                "process": formatted_process,
                "is_extracted": True,
                "device_type": result_data.get("device_type", "unknown"),
                "composition": result_data.get("composition", "Unknown"),
                "structure": result_data.get("structure", "Unknown")
            }
        }

    if not validate_doi(doi):
        raise HTTPException(status_code=400, detail="Invalid DOI format")

    db = SessionLocal()
    try:
        paper = db.query(Paper).filter(Paper.doi == doi).first()

        if not paper:
            basic_info = await crawler.get_paper_by_doi(doi)
            if basic_info:
                return {
                    "success": True,
                    "data": {
                        "title": basic_info.get("title", "Unknown Title"),
                        "journal": basic_info.get("journal", "Unknown Journal"),
                        "year": basic_info.get("year", 2024),
                        "authors": basic_info.get("authors", "Unknown Authors"),
                        "abstract": basic_info.get("abstract") or "No abstract available.",
                        "metrics": [],
                        "process": [],
                        "is_extracted": False
                    }
                }
            return {"success": False, "error": "Paper not found", "code": "PAPER_NOT_FOUND"}

        is_placeholder = paper.title.startswith("Auto-extracted") or not paper.abstract or paper.abstract == "No abstract available."
        if is_placeholder:
            paper_info = await crawler.get_paper_by_doi(doi)
            if paper_info:
                paper.title = paper_info.get('title', paper.title)
                paper.abstract = paper_info.get('abstract', paper.abstract)
                paper.authors = paper_info.get('authors', paper.authors)
                paper.journal = paper_info.get('journal', paper.journal)
                paper.year = paper_info.get('year', paper.year)
                db.commit()
                db.refresh(paper)

        # All data is now in the Literature entity (unified from Paper + ExtractionResult)
        evidence_map = json.loads(paper.source_mapping) if paper.source_mapping else {}

        metrics = []
        if paper.is_extracted:
            process_data = json.loads(paper.process_params) if paper.process_params else {}
            perf_data = json.loads(paper.performance_data) if paper.performance_data else {}

            if isinstance(process_data, dict) and 'metrics' in process_data:
                metrics = process_data['metrics']
            elif perf_data:
                # Build metrics from performance_data + evidence
                metrics = [
                    {"label": "PCE", "value": perf_data.get("pce", "N/A"), "unit": "%", "evidence": evidence_map.get("PCE")},
                    {"label": "Voc", "value": perf_data.get("voc", "N/A"), "unit": "V", "evidence": evidence_map.get("Voc")},
                    {"label": "Jsc", "value": perf_data.get("jsc", "N/A"), "unit": "mA/cm²", "evidence": evidence_map.get("Jsc")},
                    {"label": "FF", "value": perf_data.get("ff", "N/A"), "unit": "%", "evidence": evidence_map.get("FF")}
                ]

        return {
            "success": True,
            "data": {
                "title": paper.title,
                "journal": paper.journal,
                "year": paper.year,
                "authors": paper.authors,
                "abstract": paper.abstract or "Abstract not available.",
                "metrics": metrics,
                "process": json.loads(paper.process_params) if paper.process_params and paper.is_extracted else [],
                "is_extracted": paper.is_extracted
            }
        }
    finally:
        db.close()


@app.post("/api/translate")
async def translate_abstract(request: dict):
    text = request.get("text")
    if not text:
        return {"success": False, "error": "No text provided"}
    translated = await translator.translate_text(text)
    return {"success": True, "data": translated}


@app.get("/api/history")
async def get_search_history():
    db = SessionLocal()
    try:
        papers = db.query(Paper).order_by(Paper.created_at.desc()).limit(20).all()
        history_data = [
            {
                "doi": p.doi,
                "title": p.title,
                "journal": p.journal,
                "year": p.year,
                "authors": p.authors,
                "is_extracted": p.is_extracted,
                "created_at": p.created_at.isoformat() if p.created_at else None
            } for p in papers
        ]

        for upload_id, result in upload_results.items():
            history_data.insert(0, {
                "doi": upload_id,
                "title": result.get("title", "Uploaded PDF"),
                "journal": "Local File",
                "year": 2024,
                "authors": "Uploaded by user",
                "is_extracted": True,
                "created_at": datetime.datetime.now().isoformat()
            })

        return {"success": True, "data": history_data}
    finally:
        db.close()


@app.delete("/api/history/clear")
async def clear_all_history():
    db = SessionLocal()
    try:
        # V2.1: Delete from new tables
        from core.database import Literature, QuickQuestion, SIFile
        db.query(QuickQuestion).delete()
        db.query(SIFile).delete()
        db.query(Literature).delete()
        db.commit()
        crawler.clear_downloads()
        return {"success": True, "message": "All history and files cleared"}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


@app.get("/api/extract/{doi:path}")
async def start_extraction(doi: str):
    if not validate_doi(doi):
        raise HTTPException(status_code=400, detail="Invalid DOI format")

    if doi in active_extractions:
        async def wait_generator():
            yield f"data: {json.dumps({'status': 'extracting', 'message': 'Already being extracted, please wait...', 'progress': 50})}\n\n"
        return StreamingResponse(wait_generator(), media_type="text/event-stream")

    active_extractions.add(doi)

    async def event_generator():
        try:
            async for step in extractor.process_full_paper(doi):
                yield f"data: {json.dumps(step)}\n\n"
        except Exception as e:
            error_event = {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            yield f"data: {json.dumps(error_event)}\n\n"
        finally:
            active_extractions.discard(doi)
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/extract_local")
async def start_local_extraction(path: str):
    try:
        file_path = validate_file_path(path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        if file_path.suffix.lower() != '.pdf':
            raise HTTPException(status_code=400, detail="Invalid file type (only PDF allowed)")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid file path: {str(e)}")

    async def event_generator():
        try:
            async for step in extractor.process_local_pdf(str(file_path)):
                yield f"data: {json.dumps(step)}\n\n"
        except Exception as e:
            error_event = {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            yield f"data: {json.dumps(error_event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")


# Upload file storage
upload_status = {}
upload_lock = {}
upload_results = {}
upload_files = {}


@app.post("/api/extract_upload")
async def upload_pdf_for_extraction(file: UploadFile = File(...)):
    import uuid

    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    upload_id = f"upload_{uuid.uuid4().hex[:8]}"
    upload_dir = Path(os.getenv('TEMP', '/tmp')) / 'sia_uploads'
    upload_dir.mkdir(exist_ok=True)

    file_path = upload_dir / f"{upload_id}.pdf"

    try:
        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        upload_status[upload_id] = {
            "status": "uploaded",
            "file_path": str(file_path),
            "filename": file.filename
        }
        upload_lock[upload_id] = False
        upload_files[upload_id] = str(file_path)

        return {"success": True, "data": {"doi": upload_id, "filename": file.filename}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")


@app.get("/api/extract_upload/status/{upload_id}")
async def get_upload_extraction_status(upload_id: str):
    if upload_id not in upload_status:
        raise HTTPException(status_code=404, detail="Upload not found")

    if upload_lock.get(upload_id, False):
        async def wait_for_completion():
            max_wait = 120
            waited = 0
            while upload_id in upload_status and waited < max_wait:
                await asyncio.sleep(1)
                waited += 1
                if upload_status[upload_id].get("status") == "completed":
                    yield f"data: {json.dumps(upload_status[upload_id].get('result', {}))}\n\n"
                    return
            yield f"data: {json.dumps({'status': 'failed', 'error': 'Timeout waiting for completion'})}\n\n"
        return StreamingResponse(wait_for_completion(), media_type="text/event-stream")

    upload_lock[upload_id] = True

    file_info = upload_status[upload_id]
    file_path = Path(file_info["file_path"])

    if not file_path.exists():
        upload_lock[upload_id] = False
        raise HTTPException(status_code=404, detail="Uploaded file not found")

    async def event_generator():
        try:
            async for step in extractor.process_local_pdf(str(file_path)):
                yield f"data: {json.dumps(step)}\n\n"
                if step.get("status") == "completed":
                    upload_status[upload_id]["status"] = "completed"
                    upload_status[upload_id]["result"] = step
                    upload_results[upload_id] = step.get("result", {})

            await asyncio.sleep(2)
            try:
                if upload_id in upload_status:
                    del upload_status[upload_id]
                if upload_id in upload_lock:
                    del upload_lock[upload_id]
            except:
                pass
        except Exception as e:
            error_event = {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/export/excel")
async def export_excel(dois: str = None):
    db = SessionLocal()
    try:
        if not dois or dois == "all":
            papers = db.query(Paper).filter(Paper.is_extracted == True).all()
            doi_list = [p.doi for p in papers]
        else:
            doi_list = [d.strip() for d in dois.split(',') if d.strip()]

        if not doi_list:
            raise HTTPException(status_code=400, detail="No extracted papers found to export.")

        output = exporter.export_to_excel(db, doi_list)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=SIA_Export_All_{datetime.datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"}
        )
    finally:
        db.close()


@app.get("/api/pdf/{doi:path}")
async def get_pdf(doi: str):
    if doi.startswith("upload_"):
        if doi not in upload_files:
            raise HTTPException(status_code=404, detail="Uploaded PDF not found or has been cleaned up.")
        file_path = upload_files[doi]
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Uploaded PDF file missing.")
        return FileResponse(file_path, media_type="application/pdf")

    safe_filename = doi.replace("/", "_").replace("\\", "_") + ".pdf"
    file_path = os.path.join(crawler.download_dir, safe_filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="PDF not found. Please run extraction first.")

    return FileResponse(file_path, media_type="application/pdf")


if __name__ == "__main__":
    port = int(os.environ.get("SIA_PORT", os.environ.get("PIA_PORT", 8000)))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
