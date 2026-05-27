"""Extraction API routes — SSE-based Stage1/Stage2 extraction with 5-stage progress."""

import json
import datetime
import logging
import os

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from core.stage1 import stage1_screener
from core.progress import remove_tracker, get_tracker
from core.database import SessionLocal, Literature

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extract"])


def _resolve_local_pdf(doi: str) -> str | None:
    """For upload_/local_ DOIs, resolve the local PDF file path from DB or upload manager."""
    if doi.startswith("upload_"):
        from core.upload_manager import upload_manager
        file_path = upload_manager.get_file_path(doi)
        if file_path and os.path.exists(file_path):
            return file_path
    # Fallback: check Literature table (covers both upload_ and local_ DOIs)
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if lit and lit.local_pdf_path and os.path.exists(lit.local_pdf_path):
            return lit.local_pdf_path
    finally:
        db.close()
    return None


@router.post("/{doi:path}/stage1")
async def start_stage1(doi: str):
    """SSE: Stage1 abstract screening (~$0.001/paper, ~2s).

    SSE event format:
    - status: screening — in-progress with progress info
    - status: completed — screening done with result
    - status: failed — error occurred
    """
    async def event_stream():
        try:
            async for event in stage1_screener.screen_paper(doi):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Stage1 SSE error for {doi}: {e}")
            yield f"data: {json.dumps({'status': 'failed', 'error': str(e), 'timestamp': datetime.datetime.now().isoformat()})}\n\n"
        finally:
            remove_tracker(doi)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{doi:path}/deep")
async def start_deep_extraction(doi: str):
    """SSE: Stage2 deep extraction with 5-stage progress.

    Stages: downloading → parsing → analyzing_si → extracting → saving
    Each event includes progress info with estimated remaining time.
    Supports upload_/local_ DOIs by resolving to local PDF paths.

    SSE event format:
    - status: downloading/parsing/analyzing_si/extracting — in-progress
    - status: completed — extraction done with result
    - status: failed — error occurred
    - status: cached — already extracted, returning cached result
    """
    from core.extractor import extractor

    local_pdf = _resolve_local_pdf(doi)

    async def event_stream():
        try:
            gen = extractor.process_local_pdf(local_pdf) if local_pdf else extractor.process_full_paper(doi)
            async for event in gen:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Stage2 SSE error for {doi}: {e}")
            yield f"data: {json.dumps({'status': 'failed', 'error': str(e), 'timestamp': datetime.datetime.now().isoformat()})}\n\n"
        finally:
            remove_tracker(doi)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{doi:path}/status")
async def get_extraction_status(doi: str):
    """Get current extraction status."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            return {"success": True, "data": {"stage": "none", "progress": 0}}

        stage = lit.extraction_stage or "none"

        # Check for active progress tracker
        tracker = get_tracker(doi)
        if tracker:
            progress_info = tracker.get_progress()
            return {
                "success": True,
                "data": {
                    "stage": stage,
                    "progress": progress_info.get("progress", 0),
                    "current_label": progress_info.get("current_label", ""),
                    "eta_seconds": progress_info.get("eta_seconds"),
                    "is_extracted": lit.is_extracted,
                    "relevance_score": lit.relevance_score,
                    "quality_flag": lit.quality_flag,
                },
            }

        progress = 100 if stage == "stage2" else 50 if stage == "stage1" else 0

        return {
            "success": True,
            "data": {
                "stage": stage,
                "progress": progress,
                "is_extracted": lit.is_extracted,
                "relevance_score": lit.relevance_score,
                "quality_flag": lit.quality_flag,
            },
        }
    finally:
        db.close()


@router.post("/{doi:path}/cancel")
async def cancel_extraction(doi: str):
    """Cancel an ongoing extraction."""
    tracker = get_tracker(doi)
    if tracker:
        tracker.cancel()
        return {"success": True, "data": {"message": "Extraction cancelled"}}
    return {"success": True, "data": {"message": "No active extraction found"}}


# ============================================================
# V1 backward-compat routes (migrated from main.py)
# ============================================================

import re
import uuid
import asyncio
import os
from pathlib import Path
from fastapi import HTTPException, UploadFile, File

DOI_PATTERN = re.compile(r'^10\.\d{4,9}/[-._;()/:A-Z0-9]+$', re.IGNORECASE)

active_extractions = set()


def _validate_file_path(file_path: str) -> Path:
    """Validate file path is within allowed directories."""
    import os
    path = Path(file_path).resolve()
    allowed_dir = Path(os.environ.get('APPDATA', os.path.expanduser('~'))) / 'SIA' / 'downloads'
    try:
        path.relative_to(allowed_dir)
        return path
    except ValueError:
        legacy_dir = Path(os.environ.get('APPDATA', os.path.expanduser('~'))) / 'PIA_Agent' / 'downloads'
        try:
            path.relative_to(legacy_dir)
            return path
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: file path outside allowed directory")


@router.get("/v1/{doi:path}")
async def v1_start_extraction(doi: str):
    """V1 compat: Start DOI extraction via SSE (GET method).

    Note: Original V1 path was GET /api/extract/{doi}, but that conflicts
    with POST /api/extract/{doi}/deep. The main.py V1 route is preserved
    as a thin redirect. Prefer POST /api/extract/{doi}/deep for V2.
    """
    if not DOI_PATTERN.match(doi) and not doi.startswith(("upload_", "local_")):
        raise HTTPException(status_code=400, detail="Invalid DOI format")

    if doi in active_extractions:
        async def wait_generator():
            yield f"data: {json.dumps({'status': 'extracting', 'message': 'Already being extracted, please wait...', 'progress': 50})}\n\n"
        return StreamingResponse(wait_generator(), media_type="text/event-stream")

    active_extractions.add(doi)

    from core.extractor import extractor as ext

    local_pdf = _resolve_local_pdf(doi)

    async def event_generator():
        try:
            gen = ext.process_local_pdf(local_pdf) if local_pdf else ext.process_full_paper(doi)
            async for step in gen:
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


@router.post("/local")
async def v1_extract_local(body: dict):
    """V1 compat: Extract from local PDF path.

    Request body: { "path": "/path/to/file.pdf" }
    """
    path = body.get("path", "")
    try:
        file_path = _validate_file_path(path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        if file_path.suffix.lower() != '.pdf':
            raise HTTPException(status_code=400, detail="Invalid file type (only PDF allowed)")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid file path: {str(e)}")

    from core.extractor import extractor as ext

    async def event_generator():
        try:
            async for step in ext.process_local_pdf(str(file_path)):
                yield f"data: {json.dumps(step)}\n\n"
        except Exception as e:
            error_event = {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/upload")
async def v1_upload_pdf(file: UploadFile = File(...)):
    """V1 compat: Upload PDF for extraction."""
    from core.upload_manager import upload_manager

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

        upload_manager.register_upload(upload_id, str(file_path), file.filename)
        return {"success": True, "data": {"doi": upload_id, "filename": file.filename}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")


@router.get("/upload/{upload_id}/status")
async def v1_get_upload_status(upload_id: str):
    """V1 compat: Get upload extraction status via SSE."""
    from core.upload_manager import upload_manager
    from core.extractor import extractor as ext

    if not upload_manager.has_upload(upload_id):
        raise HTTPException(status_code=404, detail="Upload not found")

    if upload_manager.is_locked(upload_id):
        async def wait_for_completion():
            max_wait = 120
            waited = 0
            while upload_manager.has_upload(upload_id) and waited < max_wait:
                await asyncio.sleep(1)
                waited += 1
                status = upload_manager.get_status(upload_id)
                if status and status.get("status") == "completed":
                    result = upload_manager.get_result(upload_id)
                    yield f"data: {json.dumps(result)}\n\n"
                    return
            yield f"data: {json.dumps({'status': 'failed', 'error': 'Timeout waiting for completion'})}\n\n"
        return StreamingResponse(wait_for_completion(), media_type="text/event-stream")

    upload_manager.set_locked(upload_id, True)

    status = upload_manager.get_status(upload_id)
    file_path = Path(status["file_path"])

    if not file_path.exists():
        upload_manager.set_locked(upload_id, False)
        raise HTTPException(status_code=404, detail="Uploaded file not found")

    async def event_generator():
        try:
            async for step in ext.process_local_pdf(str(file_path)):
                yield f"data: {json.dumps(step)}\n\n"
                if step.get("status") == "completed":
                    upload_manager.update_completed(upload_id, step)

            await asyncio.sleep(2)
            upload_manager.cleanup(upload_id)
        except Exception as e:
            error_event = {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
