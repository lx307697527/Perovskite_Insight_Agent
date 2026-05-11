"""Extraction API routes — SSE-based Stage1/Stage2 extraction with 5-stage progress."""

import json
import datetime
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from core.stage1 import stage1_screener
from core.progress import remove_tracker, get_tracker
from core.database import SessionLocal, Literature

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extract"])


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

    SSE event format:
    - status: downloading/parsing/analyzing_si/extracting — in-progress
    - status: completed — extraction done with result
    - status: failed — error occurred
    - status: cached — already extracted, returning cached result
    """
    from core.extractor import extractor

    async def event_stream():
        try:
            async for event in extractor.process_full_paper(doi):
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
