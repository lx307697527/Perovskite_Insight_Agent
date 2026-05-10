"""Literature and inbox API routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["literature"])


@router.post("/literature/add")
async def add_literature(body: dict):
    """Unified add: auto-detect DOI / PDF upload / keyword search."""
    # TODO: Phase 1 — UnifiedInputBox backend
    return {"success": True, "data": {"message": "Not implemented yet"}}


@router.post("/literature/upload")
async def upload_literature(body: dict):
    """Upload a PDF file."""
    # TODO: Phase 1
    return {"success": True, "data": {"doi": "todo"}}


@router.post("/literature/doi")
async def resolve_doi(body: dict):
    """Resolve DOI: download + fetch metadata."""
    # TODO: Phase 1
    return {"success": True, "data": {}}


@router.delete("/literature/{doi:path}")
async def delete_literature(doi: str):
    """Delete a literature entry."""
    # TODO: Phase 1
    return {"success": True, "data": {"message": "Deleted"}}


@router.get("/literature/{doi:path}")
async def get_literature(doi: str):
    """Get literature details including extraction results."""
    # TODO: Phase 1 — delegate to existing main.py logic
    return {"success": True, "data": {}}


@router.get("/inbox")
async def list_inbox():
    """List literature in the temporary inbox (project_id=NULL)."""
    # TODO: Phase 1
    return {"success": True, "data": []}


@router.post("/inbox/{doi:path}/move")
async def move_from_inbox(doi: str, body: dict):
    """Move literature from inbox to a project."""
    # TODO: Phase 1
    return {"success": True, "data": {"message": "Moved"}}
