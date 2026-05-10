"""Compare and export API routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["compare"])


@router.get("/project/{project_id}/compare")
async def get_compare_data(project_id: str, filter: str = None):
    """Get comparison data for project literature with optional condition filtering."""
    # TODO: Phase 3 — core/normalizer.py
    return {"success": True, "data": []}


@router.post("/project/{project_id}/compare/export")
async def export_comparison(project_id: str, body: dict):
    """Export comparison data in specified format (excel/csv/latex/png)."""
    # TODO: Phase 3 — extended core/exporter.py
    return {"success": True, "data": {"message": "Not implemented yet"}}
