"""Q&A API routes — precise question answering with RAG + SSE streaming."""

import re
import json
import datetime
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.qa_engine import answer_question, get_qa_history, get_suggestions
from core.model_manager import get_status as get_embedding_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/qa", tags=["qa"])

DOI_PATTERN = re.compile(r'^10\.\d{4,9}/[-._;()/:A-Z0-9]+$', re.IGNORECASE)


class QuestionRequest(BaseModel):
    question: str


def _validate_doi(doi: str) -> None:
    """Validate DOI format. Raises HTTPException if invalid."""
    if not DOI_PATTERN.match(doi):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid DOI format: {doi}. Expected format: 10.xxxx/...",
        )


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


@router.post("/{doi:path}")
async def ask_question(doi: str, body: QuestionRequest):
    """SSE: Precise Q&A with RAG + LLM streaming (<5s, ~$0.005/question).

    SSE event types:
    - content: streaming text chunk {type, text, timestamp}
    - source: page citation {type, page, excerpt, file, section, relevance, timestamp}
              May emit multiple source events for multi-source answers.
              file: "main" or "si" (Supporting Information)
    - done: completion {type, cost, tokens, timestamp}
    - error: error message {type, message, timestamp}
    """
    _validate_doi(doi)

    if not body.question or not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    if len(body.question) > 1000:
        raise HTTPException(status_code=400, detail="Question too long (max 1000 characters)")

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
                detail=f"Embedding model not available (status: {emb_status}). Please check configuration.",
            )

    # Verify paper exists in DB
    from core.database import SessionLocal, Literature
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            raise HTTPException(
                status_code=404,
                detail=f"Paper {doi} not found. Please add it to your library first.",
            )
    finally:
        db.close()

    client, model = _get_client_and_model()

    async def event_stream():
        try:
            async for event in answer_question(doi, body.question.strip(), client, model):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Q&A SSE error for {doi}: {e}")
            error_event = {
                "type": "error",
                "message": str(e),
                "timestamp": datetime.datetime.now().isoformat(),
            }
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{doi:path}/history")
async def get_history(doi: str):
    """Get Q&A history for a paper."""
    _validate_doi(doi)
    try:
        records = get_qa_history(doi)
        return {"success": True, "data": records}
    except Exception as e:
        logger.error(f"Failed to get Q&A history for {doi}: {e}")
        return {"success": False, "error": str(e)}


@router.get("/{doi:path}/suggestions")
async def get_qa_suggestions(doi: str):
    """Auto-generate 3-5 quick questions for a paper."""
    _validate_doi(doi)
    try:
        client, model = _get_client_and_model()
        suggestions = await get_suggestions(doi, client, model)
        return {"success": True, "data": suggestions}
    except Exception as e:
        logger.error(f"Failed to get Q&A suggestions for {doi}: {e}")
        return {"success": False, "error": str(e), "data": []}
