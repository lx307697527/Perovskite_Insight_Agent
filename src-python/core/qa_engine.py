"""
Precision Q&A Engine for SIA V2.1.

FAISS-based RAG pipeline:
1. Load paper markdown → chunk into 512-token paragraphs
2. Embed chunks via BGE-base-en-v1.5
3. Build FAISS index for cosine similarity search
4. Given a question: embed → top-k retrieval → LLM answer with source tracking
5. Persist FAISS index to disk for reuse
"""

import os
import json
import uuid
import logging
import datetime
import threading
from typing import Optional

from . import model_manager
from .database import SessionLocal, Literature, QuickQuestion
from .pdf_engine import pdf_processor

logger = logging.getLogger(__name__)

_SIA_DIR = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
)
_FAISS_DIR = os.path.join(_SIA_DIR, "cache", "faiss")

# In-memory index cache: doi -> (faiss_index, chunks_metadata)
_index_cache: dict[str, tuple] = {}
_cache_lock = threading.Lock()

# Active Q&A tasks to prevent duplicate processing
_active_qa: set[str] = set()
_active_qa_lock = threading.Lock()

CHUNK_SIZE = 512  # tokens
CHUNK_OVERLAP = 64  # tokens
TOP_K = 5  # retrieval count


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English, ~2 for Chinese."""
    chinese_chars = sum(1 for c in text if '一' <= c <= '鿿')
    other_chars = len(text) - chinese_chars
    return chinese_chars // 2 + other_chars // 4


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """Split text into overlapping chunks with page tracking.
    Returns list of {text, page, char_start, char_end}.
    """
    if not text:
        return []

    # Split by page markers (from pdf_engine: "--- PAGE N ---")
    import re
    pages = re.split(r'---\s*PAGE\s+(\d+)\s*---', text)

    chunks = []
    current_page = 1

    # pages: [before_first_marker, page_num, content, page_num, content, ...]
    i = 0
    while i < len(pages):
        if i % 2 == 1:
            current_page = int(pages[i])
            i += 1
            continue

        page_text = pages[i].strip()
        i += 1

        if not page_text:
            continue

        # Further split long page content into chunks
        words = page_text.split()
        if not words:
            continue

        pos = 0
        while pos < len(words):
            chunk_words = words[pos:pos + chunk_size]
            chunk_text = ' '.join(chunk_words)
            chunks.append({
                "text": chunk_text,
                "page": current_page,
                "char_start": 0,
                "char_end": len(chunk_text),
            })
            pos += chunk_size - overlap

    return chunks


def _get_or_build_index(doi: str) -> Optional[tuple]:
    """Get or build FAISS index for a paper. Returns (index, chunks) or None."""
    # Check in-memory cache
    with _cache_lock:
        if doi in _index_cache:
            return _index_cache[doi]

    # Check disk cache
    lit_index_path = os.path.join(_FAISS_DIR, "literature", f"{doi.replace('/', '_')}.faiss")
    meta_path = os.path.join(_FAISS_DIR, "literature", f"{doi.replace('/', '_')}.json")

    if os.path.exists(lit_index_path) and os.path.exists(meta_path):
        try:
            import faiss
            index = faiss.read_index(lit_index_path)
            with open(meta_path, 'r', encoding='utf-8') as f:
                chunks = json.load(f)
            with _cache_lock:
                _index_cache[doi] = (index, chunks)
            return (index, chunks)
        except Exception as e:
            logger.warning(f"Failed to load cached index for {doi}: {e}")

    # Build new index
    return _build_index(doi)


def _build_index(doi: str) -> Optional[tuple]:
    """Build FAISS index from paper content."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            logger.warning(f"Literature {doi} not found in DB")
            return None

        # Get markdown content
        markdown = ""
        if lit.local_pdf_path and os.path.exists(lit.local_pdf_path):
            import asyncio
            markdown = asyncio.get_event_loop().run_until_complete(
                pdf_processor.convert_to_markdown(lit.local_pdf_path)
            ) if not _is_running_async() else None

        # Fallback: use cached process_params / source_mapping text
        if not markdown:
            combined = []
            if lit.abstract:
                combined.append(lit.abstract)
            if lit.performance_data:
                combined.append(f"Performance: {lit.performance_data}")
            if lit.process_params:
                combined.append(f"Process: {lit.process_params}")
            if lit.source_mapping:
                combined.append(f"Evidence: {lit.source_mapping}")
            markdown = "\n\n".join(combined)

        if not markdown:
            logger.warning(f"No content available for {doi}")
            return None

        chunks = _chunk_text(markdown)
        if not chunks:
            logger.warning(f"No chunks generated for {doi}")
            return None

        # Embed chunks
        texts = [c["text"] for c in chunks]
        embeddings = model_manager.embed_texts(texts)
        if embeddings is None:
            logger.warning(f"Embedding model not ready for {doi}")
            return None

        # Build FAISS index
        import faiss
        import numpy as np

        dim = len(embeddings[0])
        embedding_matrix = np.array(embeddings, dtype=np.float32)
        faiss.normalize_L2(embedding_matrix)

        index = faiss.IndexFlatIP(dim)  # Inner product = cosine similarity for normalized vectors
        index.add(embedding_matrix)

        # Persist to disk
        os.makedirs(os.path.join(_FAISS_DIR, "literature"), exist_ok=True)
        safe_doi = doi.replace('/', '_')
        try:
            faiss.write_index(index, os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.faiss"))
            with open(os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.json"), 'w', encoding='utf-8') as f:
                json.dump(chunks, f, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Failed to persist FAISS index for {doi}: {e}")

        # Cache in memory
        with _cache_lock:
            _index_cache[doi] = (index, chunks)

        return (index, chunks)

    except Exception as e:
        logger.error(f"Failed to build index for {doi}: {e}")
        return None
    finally:
        db.close()


def _is_running_async() -> bool:
    """Check if we're inside an async event loop."""
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        return loop.is_running()
    except RuntimeError:
        return False


async def build_index_async(doi: str) -> Optional[tuple]:
    """Async version of index building for use in API handlers."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            return None

        # Try to get markdown from cached PDF
        markdown = ""
        if lit.local_pdf_path and os.path.exists(lit.local_pdf_path):
            markdown = await pdf_processor.convert_to_markdown(lit.local_pdf_path)

        # Fallback: use DB text
        if not markdown:
            combined = []
            if lit.abstract:
                combined.append(lit.abstract)
            if lit.performance_data:
                combined.append(f"Performance: {lit.performance_data}")
            if lit.process_params:
                combined.append(f"Process: {lit.process_params}")
            if lit.source_mapping:
                combined.append(f"Evidence: {lit.source_mapping}")
            markdown = "\n\n".join(combined)

        if not markdown:
            return None

        chunks = _chunk_text(markdown)
        if not chunks:
            return None

        # Embed
        texts = [c["text"] for c in chunks]
        embeddings = model_manager.embed_texts(texts)
        if embeddings is None:
            return None

        # Build FAISS index
        import faiss
        import numpy as np

        dim = len(embeddings[0])
        embedding_matrix = np.array(embeddings, dtype=np.float32)
        faiss.normalize_L2(embedding_matrix)

        index = faiss.IndexFlatIP(dim)
        index.add(embedding_matrix)

        # Persist
        os.makedirs(os.path.join(_FAISS_DIR, "literature"), exist_ok=True)
        safe_doi = doi.replace('/', '_')
        try:
            faiss.write_index(index, os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.faiss"))
            with open(os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.json"), 'w', encoding='utf-8') as f:
                json.dump(chunks, f, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Failed to persist FAISS index: {e}")

        with _cache_lock:
            _index_cache[doi] = (index, chunks)

        return (index, chunks)

    except Exception as e:
        logger.error(f"build_index_async failed for {doi}: {e}")
        return None
    finally:
        db.close()


async def answer_question(doi: str, question: str, client, model: str):
    """Answer a question about a paper using RAG. Yields SSE events.

    Args:
        doi: Paper DOI
        question: User's question
        client: OpenAI async client
        model: Model name for LLM

    Yields:
        SSE event dicts with type: content/source/done/error
    """
    import openai

    # Prevent duplicate processing
    with _active_qa_lock:
        if doi in _active_qa:
            yield {
                "type": "error",
                "message": "A Q&A request is already being processed for this paper. Please wait.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return
        _active_qa.add(doi)

    try:
        # Step 1: Build or load index
        yield {
            "type": "content",
            "text": "",
            "timestamp": datetime.datetime.now().isoformat(),
        }

        index_result = await build_index_async(doi)
        if index_result is None:
            yield {
                "type": "error",
                "message": "Cannot build search index for this paper. Make sure the PDF has been extracted first.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        index, chunks = index_result

        # Step 2: Embed question and retrieve top-k chunks
        q_embedding = model_manager.embed_single(question)
        if q_embedding is None:
            yield {
                "type": "error",
                "message": "Embedding model not ready. Please wait for it to load or check configuration.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        import numpy as np
        q_vector = np.array([q_embedding], dtype=np.float32)
        import faiss
        faiss.normalize_L2(q_vector)

        scores, indices = index.search(q_vector, TOP_K)

        # Gather relevant context
        relevant_chunks = []
        for i, idx in enumerate(indices[0]):
            if idx < len(chunks) and idx >= 0:
                chunk = chunks[idx]
                relevant_chunks.append({
                    "text": chunk["text"],
                    "page": chunk["page"],
                    "score": float(scores[0][i]),
                })

        if not relevant_chunks:
            yield {
                "type": "error",
                "message": "No relevant content found for this question in the paper.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        # Step 3: Build context for LLM
        context_parts = []
        best_source = relevant_chunks[0]  # Track best source for citation

        for rc in relevant_chunks:
            context_parts.append(f"[Page {rc['page']}] {rc['text']}")

        context_text = "\n\n---\n\n".join(context_parts)

        from .prompts import QA_PRECISION_PROMPT
        prompt = QA_PRECISION_PROMPT.replace("{question}", question).replace("{context}", context_text)

        # Step 4: Stream LLM response
        total_tokens = 0
        answer_text = ""

        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a precise scientific Q&A assistant. Answer based ONLY on the provided context. Always cite the page number."},
                    {"role": "user", "content": prompt},
                ],
                stream=True,
                timeout=30.0,
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
            logger.error(f"LLM streaming failed: {e}")
            # Fallback: non-streaming
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "You are a precise scientific Q&A assistant. Answer based ONLY on the provided context. Always cite the page number."},
                        {"role": "user", "content": prompt},
                    ],
                    timeout=30.0,
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

        # Step 5: Source citation event
        yield {
            "type": "source",
            "page": best_source["page"],
            "excerpt": best_source["text"][:300],
            "file": "main",
            "timestamp": datetime.datetime.now().isoformat(),
        }

        # Step 6: Save to DB
        cost_estimate = (total_tokens / 1_000_000) * 0.15 if total_tokens > 0 else 0.001
        db = SessionLocal()
        try:
            qa_record = QuickQuestion(
                id=str(uuid.uuid4()),
                literature_doi=doi,
                question=question,
                answer=answer_text,
                source=json.dumps({"page": best_source["page"], "excerpt": best_source["text"][:300]}),
                cost=cost_estimate,
                tokens_used=total_tokens,
            )
            db.add(qa_record)
            db.commit()
        except Exception as e:
            logger.error(f"Failed to save Q&A record: {e}")
            db.rollback()
        finally:
            db.close()

        # Done event
        yield {
            "type": "done",
            "cost": round(cost_estimate, 4),
            "tokens": total_tokens,
            "timestamp": datetime.datetime.now().isoformat(),
        }

    finally:
        with _active_qa_lock:
            _active_qa.discard(doi)


async def get_suggestions(doi: str, client, model: str) -> list[str]:
    """Auto-generate 3-5 quick questions for a paper."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            return []

        # Build context from available data
        context_parts = []
        if lit.title:
            context_parts.append(f"Title: {lit.title}")
        if lit.abstract:
            context_parts.append(f"Abstract: {lit.abstract[:1000]}")
        if lit.performance_data:
            try:
                perf = json.loads(lit.performance_data)
                context_parts.append(f"Key metrics: {json.dumps(perf)[:500]}")
            except Exception:
                pass

        if not context_parts:
            return ["What is the main contribution of this paper?",
                    "What materials are used in this study?",
                    "What are the key performance metrics?"]

        from .prompts import QA_SUGGESTIONS_PROMPT
        prompt = QA_SUGGESTIONS_PROMPT.replace("{context}", "\n".join(context_parts))

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a scientific research assistant. Generate concise, specific questions about the paper."},
                    {"role": "user", "content": prompt},
                ],
                timeout=15.0,
            )
            raw = response.choices[0].message.content or ""

            # Parse numbered questions
            import re
            questions = re.findall(r'(?:\d+\.\s*|[-•]\s*)(.+?)(?:\n|$)', raw)
            if not questions:
                questions = [line.strip() for line in raw.strip().split('\n') if line.strip() and len(line.strip()) > 10]

            return questions[:5]

        except Exception as e:
            logger.error(f"Failed to generate suggestions: {e}")
            return ["What is the main contribution of this paper?",
                    "What materials are used in this study?",
                    "What are the key performance metrics?"]

    finally:
        db.close()


def get_qa_history(doi: str) -> list[dict]:
    """Get Q&A history for a paper."""
    db = SessionLocal()
    try:
        records = db.query(QuickQuestion).filter(
            QuickQuestion.literature_doi == doi
        ).order_by(QuickQuestion.created_at.desc()).limit(50).all()

        return [
            {
                "id": r.id,
                "question": r.question,
                "answer": r.answer,
                "source": json.loads(r.source) if r.source else None,
                "cost": r.cost,
                "tokens_used": r.tokens_used,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ]
    finally:
        db.close()


def invalidate_index(doi: str):
    """Invalidate cached FAISS index for a paper (e.g., after re-extraction)."""
    with _cache_lock:
        _index_cache.pop(doi, None)

    safe_doi = doi.replace('/', '_')
    faiss_path = os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.faiss")
    meta_path = os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.json")

    for path in [faiss_path, meta_path]:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
