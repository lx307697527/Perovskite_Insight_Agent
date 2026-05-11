"""
Multi-Document RAG Engine for SIA V2.1.

Aggregates per-literature FAISS indices into a project-level index
for cross-document Q&A. Reuses qa_engine's chunking and embedding.

Features:
- Build project-level FAISS index from all literature in a project
- Cross-document retrieval with DOI-prefixed context
- Chat session persistence via ChatSession/ChatMessage ORM
- SSE streaming answers with multi-doc source citations
"""

import os
import json
import uuid
import logging
import datetime
import threading
from typing import Optional

import numpy as np

from . import model_manager
from .database import SessionLocal, Literature, ChatSession, ChatMessage, Project
from .qa_engine import build_index_async, _FAISS_DIR, _cache_lock, _index_cache

logger = logging.getLogger(__name__)

TOP_K_MULTIDOC = 8  # More retrieval for multi-doc
MIN_RELEVANCE_MULTIDOC = 0.25  # Slightly lower threshold for cross-doc

# Project-level index cache: project_id -> (faiss_index, chunks_metadata)
_project_index_cache: dict[str, tuple] = {}
_project_cache_lock = threading.Lock()

# Active multi-doc tasks
_active_multidoc: set[str] = set()
_active_multidoc_lock = threading.Lock()


def _load_cached_project_index(project_id: str) -> Optional[tuple]:
    """Try to load a persisted project-level FAISS index from disk."""
    proj_index_path = os.path.join(_FAISS_DIR, "projects", f"{project_id}.faiss")
    meta_path = os.path.join(_FAISS_DIR, "projects", f"{project_id}.json")

    if not (os.path.exists(proj_index_path) and os.path.exists(meta_path)):
        return None

    try:
        import faiss
        index = faiss.read_index(proj_index_path)
        with open(meta_path, 'r', encoding='utf-8') as f:
            chunks = json.load(f)
        return (index, chunks)
    except Exception as e:
        logger.warning(f"Failed to load cached project index for {project_id}: {e}")
        return None


def _persist_project_index(project_id: str, index, chunks: list[dict]):
    """Persist project-level FAISS index and chunk metadata to disk."""
    proj_dir = os.path.join(_FAISS_DIR, "projects")
    os.makedirs(proj_dir, exist_ok=True)

    try:
        import faiss
        faiss.write_index(index, os.path.join(proj_dir, f"{project_id}.faiss"))
        with open(os.path.join(proj_dir, f"{project_id}.json"), 'w', encoding='utf-8') as f:
            json.dump(chunks, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed to persist project index for {project_id}: {e}")


async def build_project_index(project_id: str, context_dois: Optional[list[str]] = None) -> Optional[tuple]:
    """Build a project-level FAISS index from all extracted literature.

    Args:
        project_id: Project UUID
        context_dois: Optional list of specific DOIs to include.
                      If None, includes all project literature.

    Returns:
        (faiss_index, chunks_metadata) or None on failure.
    """
    # Check in-memory cache
    with _project_cache_lock:
        if project_id in _project_index_cache:
            return _project_index_cache[project_id]

    # Check disk cache
    cached = _load_cached_project_index(project_id)
    if cached is not None:
        with _project_cache_lock:
            _project_index_cache[project_id] = cached
        return cached

    # Build from scratch
    db = SessionLocal()
    try:
        # Query literature in this project
        query = db.query(Literature).filter(
            Literature.project_id == project_id,
            Literature.is_extracted == True,
        )

        if context_dois:
            query = query.filter(Literature.doi.in_(context_dois))

        literature_list = query.all()

        if not literature_list:
            logger.warning(f"No extracted literature found for project {project_id}")
            return None

        # Build per-DOI indices and collect all chunks
        all_chunks: list[dict] = []
        all_embeddings: list[np.ndarray] = []

        for lit in literature_list:
            index_result = await build_index_async(lit.doi)
            if index_result is None:
                logger.warning(f"Skipping {lit.doi}: index build failed")
                continue

            doi_index, doi_chunks = index_result

            # Re-embed chunks to get embedding vectors
            texts = [c["text"] for c in doi_chunks]
            embeddings = model_manager.embed_texts(texts)

            if embeddings is None:
                logger.warning(f"Skipping {lit.doi}: embedding failed")
                continue

            for i, chunk in enumerate(doi_chunks):
                # Add DOI metadata to each chunk
                chunk_with_doi = {
                    **chunk,
                    "doi": lit.doi,
                    "title": lit.title or lit.doi,
                }
                all_chunks.append(chunk_with_doi)
                all_embeddings.append(np.array(embeddings[i], dtype=np.float32))

        if not all_chunks:
            logger.warning(f"No chunks generated for project {project_id}")
            return None

        logger.info(
            f"Built project index for {project_id}: "
            f"{len(all_chunks)} chunks from {len(literature_list)} papers"
        )

        # Build combined FAISS index
        import faiss

        embedding_matrix = np.array(all_embeddings, dtype=np.float32)
        faiss.normalize_L2(embedding_matrix)

        dim = embedding_matrix.shape[1]
        combined_index = faiss.IndexFlatIP(dim)
        combined_index.add(embedding_matrix)

        # Persist
        _persist_project_index(project_id, combined_index, all_chunks)

        # Cache
        with _project_cache_lock:
            _project_index_cache[project_id] = (combined_index, all_chunks)

        return (combined_index, all_chunks)

    except Exception as e:
        logger.error(f"Failed to build project index for {project_id}: {e}")
        return None
    finally:
        db.close()


async def answer_multidoc_question(
    project_id: str,
    question: str,
    context_dois: Optional[list[str]],
    client,
    model: str,
):
    """Answer a question across multiple project documents. Yields SSE events.

    Args:
        project_id: Project UUID
        question: User's question
        context_dois: Optional specific DOIs to restrict context to
        client: OpenAI async client
        model: Model name for LLM

    Yields:
        SSE event dicts with type: content/source/done/error
        Source events include "doi" field for cross-document citation.
    """
    # Prevent duplicate processing
    task_key = f"{project_id}:{question[:50]}"
    with _active_multidoc_lock:
        if task_key in _active_multidoc:
            yield {
                "type": "error",
                "message": "A multi-doc Q&A request is already being processed for this project.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return
        _active_multidoc.add(task_key)

    try:
        # Step 1: Build or load project index
        yield {
            "type": "content",
            "text": "",
            "timestamp": datetime.datetime.now().isoformat(),
        }

        index_result = await build_project_index(project_id, context_dois)
        if index_result is None:
            yield {
                "type": "error",
                "message": "Cannot build project search index. Make sure literature has been extracted first.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        index, chunks = index_result

        # Step 2: Embed question and retrieve top-k chunks
        q_embedding = model_manager.embed_single(question)
        if q_embedding is None:
            yield {
                "type": "error",
                "message": "Embedding model not ready. Please wait for it to load.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        import faiss

        q_vector = np.array([q_embedding], dtype=np.float32)
        faiss.normalize_L2(q_vector)

        scores, indices = index.search(q_vector, TOP_K_MULTIDOC)

        # Gather relevant chunks
        relevant_chunks = []
        for i, idx in enumerate(indices[0]):
            if 0 <= idx < len(chunks) and scores[0][i] >= MIN_RELEVANCE_MULTIDOC:
                chunk = chunks[idx]
                relevant_chunks.append({
                    "text": chunk["text"],
                    "page": chunk.get("page", 1),
                    "doi": chunk.get("doi", ""),
                    "title": chunk.get("title", ""),
                    "score": float(scores[0][i]),
                    "source": chunk.get("source", "main"),
                    "section": chunk.get("section"),
                })

        if not relevant_chunks:
            yield {
                "type": "error",
                "message": "No relevant content found for this question across the project literature.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        # Step 3: Build context for LLM with DOI-prefixed citations
        context_parts = []
        for rc in relevant_chunks:
            doi_ref = f"[DOI: {rc['doi']}"
            if rc.get('title'):
                doi_ref += f" — {rc['title'][:60]}"
            if rc['page'] > 0:
                doi_ref += f", Page {rc['page']}"
            if rc.get('section'):
                doi_ref += f", {rc['section']}"
            if rc.get('source') == 'si':
                doi_ref += " (SI)"
            doi_ref += "]"
            context_parts.append(f"{doi_ref}\n{rc['text']}")

        context_text = "\n\n---\n\n".join(context_parts)

        from .prompts import MULTIDOC_QA_PROMPT
        prompt = MULTIDOC_QA_PROMPT.replace("{question}", question).replace("{context}", context_text)

        # Step 4: Stream LLM response
        total_tokens = 0
        answer_text = ""

        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a multi-document scientific Q&A assistant. "
                            "Answer based ONLY on the provided context from multiple research papers. "
                            "Always cite the DOI and page number. "
                            "If different papers report different values, present them all. "
                            "Synthesize cross-paper insights when possible."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                stream=True,
                timeout=60.0,
            )

            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    answer_text += text
                    yield {
                        "type": "content",
                        "text": text,
                        "timestamp": datetime.datetime.now().isoformat(),
                    }

        except Exception as e:
            logger.error(f"Multi-doc LLM streaming failed: {e}")
            # Fallback: non-streaming
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a multi-document scientific Q&A assistant. Answer based ONLY on the provided context. Always cite DOI and page number.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    timeout=60.0,
                )
                answer_text = response.choices[0].message.content or ""
                total_tokens = response.usage.total_tokens if response.usage else 0
                yield {
                    "type": "content",
                    "text": answer_text,
                    "timestamp": datetime.datetime.now().isoformat(),
                }
            except Exception as e2:
                yield {
                    "type": "error",
                    "message": f"AI model error: {str(e2)}",
                    "timestamp": datetime.datetime.now().isoformat(),
                }
                return

        # Step 5: Source citation events with DOI
        sources = []
        for rc in relevant_chunks:
            source_event = {
                "doi": rc["doi"],
                "page": rc["page"],
                "excerpt": rc["text"][:300],
                "file": rc.get("source", "main"),
                "relevance": round(rc["score"], 3),
            }
            if rc.get("section"):
                source_event["section"] = rc["section"]
            if rc.get("title"):
                source_event["title"] = rc["title"][:100]
            sources.append(source_event)

            yield {
                "type": "source",
                "timestamp": datetime.datetime.now().isoformat(),
                **source_event,
            }

        # Step 6: Save to ChatSession + ChatMessage
        session_id = str(uuid.uuid4())
        cost_estimate = (total_tokens / 1_000_000) * 0.15 if total_tokens > 0 else 0.001

        db = SessionLocal()
        try:
            chat_session = ChatSession(
                id=session_id,
                project_id=project_id,
                query=question,
                context_dois=json.dumps(context_dois or []),
            )
            db.add(chat_session)

            # User message
            user_msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session_id,
                role="user",
                content=question,
            )
            db.add(user_msg)

            # Assistant message
            assistant_msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session_id,
                role="assistant",
                content=answer_text,
                source_refs=json.dumps(sources),
            )
            db.add(assistant_msg)

            db.commit()
        except Exception as e:
            logger.error(f"Failed to save chat session: {e}")
            db.rollback()
        finally:
            db.close()

        # Done event with session_id for frontend reference
        yield {
            "type": "done",
            "session_id": session_id,
            "cost": round(cost_estimate, 4),
            "tokens": total_tokens,
            "timestamp": datetime.datetime.now().isoformat(),
        }

    finally:
        with _active_multidoc_lock:
            _active_multidoc.discard(task_key)


def list_project_sessions(project_id: str) -> list[dict]:
    """List chat sessions for a project."""
    db = SessionLocal()
    try:
        sessions = db.query(ChatSession).filter(
            ChatSession.project_id == project_id
        ).order_by(ChatSession.created_at.desc()).limit(50).all()

        return [
            {
                "id": s.id,
                "project_id": s.project_id,
                "query": s.query,
                "context_dois": json.loads(s.context_dois) if s.context_dois else [],
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "message_count": len(s.messages) if s.messages else 0,
            }
            for s in sessions
        ]
    finally:
        db.close()


def get_chat_history(session_id: str) -> Optional[dict]:
    """Get chat session details with all messages."""
    db = SessionLocal()
    try:
        session = db.query(ChatSession).filter(
            ChatSession.id == session_id
        ).first()

        if not session:
            return None

        messages = db.query(ChatMessage).filter(
            ChatMessage.session_id == session_id
        ).order_by(ChatMessage.created_at.asc()).all()

        return {
            "id": session.id,
            "project_id": session.project_id,
            "query": session.query,
            "context_dois": json.loads(session.context_dois) if session.context_dois else [],
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "source_refs": json.loads(m.source_refs) if m.source_refs else None,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in messages
            ],
        }
    finally:
        db.close()


def invalidate_project_index(project_id: str):
    """Invalidate cached project-level FAISS index."""
    with _project_cache_lock:
        _project_index_cache.pop(project_id, None)

    proj_dir = os.path.join(_FAISS_DIR, "projects")
    for ext in (".faiss", ".json"):
        path = os.path.join(proj_dir, f"{project_id}{ext}")
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
