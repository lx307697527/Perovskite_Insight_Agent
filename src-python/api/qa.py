"""Q&A API routes — precise question answering with RAG."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/qa", tags=["qa"])


@router.post("/{doi:path}")
async def ask_question(doi: str, body: dict):
    """SSE: Precise Q&A with RAG + LLM (<5s, ~$0.005/question)."""
    # TODO: Phase 2 — core/qa_engine.py
    return {"success": True, "data": {"message": "Not implemented yet"}}


@router.get("/{doi:path}/history")
async def get_qa_history(doi: str):
    """Get Q&A history for a paper."""
    # TODO: Phase 2
    return {"success": True, "data": []}


@router.get("/{doi:path}/suggestions")
async def get_qa_suggestions(doi: str):
    """Auto-generate 3-5 quick questions for a paper."""
    # TODO: Phase 2
    return {"success": True, "data": []}
