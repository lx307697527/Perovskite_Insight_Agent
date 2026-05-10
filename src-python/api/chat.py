"""Multi-doc chat API routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("")
async def start_chat(body: dict):
    """SSE: Multi-document Q&A across project literature."""
    # TODO: Phase 3 — core/rag_engine.py
    return {"success": True, "data": {"message": "Not implemented yet"}}


@router.get("/sessions")
async def list_chat_sessions():
    """List chat session history."""
    # TODO: Phase 3
    return {"success": True, "data": []}


@router.get("/sessions/{session_id}")
async def get_chat_session(session_id: str):
    """Get chat session details with all messages."""
    # TODO: Phase 3
    return {"success": True, "data": {}}
