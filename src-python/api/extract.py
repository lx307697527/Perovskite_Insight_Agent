"""Extraction API routes — SSE-based Stage1/Stage2 extraction."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/extract", tags=["extract"])


@router.post("/{doi:path}/stage1")
async def start_stage1(doi: str):
    """SSE: Stage1 abstract screening (~$0.001/paper, ~2s)."""
    # TODO: Phase 2 — core/stage1.py
    return {"success": True, "data": {"message": "Not implemented yet"}}


@router.post("/{doi:path}/deep")
async def start_deep_extraction(doi: str):
    """SSE: Stage2 deep extraction with 5-stage progress."""
    # TODO: Phase 2 — core/extractor.py Stage2
    return {"success": True, "data": {"message": "Not implemented yet"}}


@router.get("/{doi:path}/status")
async def get_extraction_status(doi: str):
    """Get current extraction status."""
    # TODO: Phase 2
    return {"success": True, "data": {"stage": "none", "progress": 0}}


@router.post("/{doi:path}/cancel")
async def cancel_extraction(doi: str):
    """Cancel an ongoing extraction."""
    # TODO: Phase 2
    return {"success": True, "data": {"message": "Cancelled"}}
