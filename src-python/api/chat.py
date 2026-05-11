"""Multi-doc chat API routes — cross-project literature Q&A with SSE streaming."""

import json
import datetime
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from core.rag_engine import answer_multidoc_question, list_project_sessions, get_chat_history
from core.model_manager import get_status as get_embedding_status
from core.database import SessionLocal, Project

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    project_id: str
    question: str
    context_dois: Optional[list[str]] = None


def _get_client_and_model():
    """Get OpenAI client and model from main app config."""
    from main import current_config
    import openai

    client = openai.AsyncOpenAI(
        api_key=current_config["apiKey"],
        base_url=current_config.get("stage2BaseUrl", current_config["baseUrl"]),
    )
    model = current_config.get("stage2Model", current_config["model"])
    return client, model


@router.post("")
async def start_chat(body: ChatRequest):
    """SSE: Multi-document Q&A across project literature.

    Request body:
    - project_id: Project UUID
    - question: User's question
    - context_dois: Optional list of specific DOIs to include

    SSE event types (same as /api/qa):
    - content: streaming text chunk {type, text, timestamp}
    - source: citation with DOI {type, doi, page, excerpt, file, relevance, timestamp}
    - done: completion {type, session_id, cost, tokens, timestamp}
    - error: error message {type, message, timestamp}
    """
    if not body.question or not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    if len(body.question) > 2000:
        raise HTTPException(status_code=400, detail="Question too long (max 2000 characters)")

    # Verify project exists
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == body.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail=f"Project {body.project_id} not found")
    finally:
        db.close()

    # Check embedding model status
    emb_status = get_embedding_status()
    if emb_status != "ready":
        if emb_status == "loading":
            raise HTTPException(
                status_code=503,
                detail="Embedding model is still loading. Please try again in a moment.",
            )
        else:
            raise HTTPException(
                status_code=503,
                detail=f"Embedding model not available (status: {emb_status}).",
            )

    client, model = _get_client_and_model()

    async def event_stream():
        try:
            async for event in answer_multidoc_question(
                body.project_id, body.question.strip(), body.context_dois, client, model
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Multi-doc chat SSE error for project {body.project_id}: {e}")
            error_event = {
                "type": "error",
                "message": str(e),
                "timestamp": datetime.datetime.now().isoformat(),
            }
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/sessions")
async def list_sessions(project_id: str = Query(..., description="Project UUID")):
    """List chat sessions for a project."""
    try:
        sessions = list_project_sessions(project_id)
        return {"success": True, "data": sessions}
    except Exception as e:
        logger.error(f"Failed to list chat sessions: {e}")
        return {"success": False, "error": str(e), "data": []}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get chat session details with all messages."""
    try:
        session = get_chat_history(session_id)
        if not session:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        return {"success": True, "data": session}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get chat session {session_id}: {e}")
        return {"success": False, "error": str(e)}
