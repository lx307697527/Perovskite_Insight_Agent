"""
Precision Q&A Engine for SIA V2.1.

FAISS-based RAG pipeline:
1. Load paper markdown (main + SI) → chunk into 512-token paragraphs
2. Embed chunks via BGE-base-en-v1.5
3. Build FAISS index for cosine similarity search
4. Given a question: embed → top-k retrieval → LLM answer with source tracking
5. Persist FAISS index to disk for reuse

V2.1 improvements over V1:
- Paragraph-level chunking (respects sentence/page boundaries)
- SI content included in the FAISS index
- Multiple source citations per answer
- Proper async-only index building (no broken sync path)
- Integration with smart_slicer for SI chunking
"""

import os
import json
import uuid
import logging
import datetime
import threading
import re
from typing import Optional

from . import model_manager
from .database import SessionLocal, Literature, QuickQuestion
from .pdf_engine import pdf_processor
from .smart_slicer import slice_si

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
MIN_RELEVANCE_SCORE = 0.3  # minimum cosine similarity to include as source


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English, ~2 for Chinese."""
    chinese_chars = sum(1 for c in text if '一' <= c <= '鿿')
    other_chars = len(text) - chinese_chars
    return chinese_chars // 2 + other_chars // 4


def _split_into_sentences(text: str) -> list[str]:
    """Split text into sentences, preserving whitespace for reconstruction."""
    # Match sentence-ending punctuation followed by space or end
    parts = re.split(r'(?<=[.!?。！？])\s+', text)
    return [p for p in parts if p.strip()]


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """Split text into overlapping chunks with page tracking.

    Uses paragraph-level chunking that respects sentence boundaries
    and tracks page numbers from pdf_engine markers (--- PAGE N ---).

    Returns list of {text, page, char_start, char_end, source}.
    """
    if not text:
        return []

    # Split by page markers (from pdf_engine: "--- PAGE N ---")
    pages = re.split(r'---\s*PAGE\s+(\d+)\s*---', text)

    # Collect all paragraphs with their page numbers
    paragraphs: list[dict] = []
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

        # Split by double newline (paragraph boundaries)
        for para in page_text.split('\n\n'):
            para = para.strip()
            if para:
                paragraphs.append({
                    "text": para,
                    "page": current_page,
                    "tokens": _estimate_tokens(para),
                })

    # Group paragraphs into chunks of ~chunk_size tokens
    chunks: list[dict] = []
    current_chunk_paras: list[dict] = []
    current_tokens = 0
    current_page = 1

    for para in paragraphs:
        para_tokens = para["tokens"]

        # If adding this paragraph exceeds chunk_size and we already have content,
        # finalize the current chunk
        if current_chunk_paras and current_tokens + para_tokens > chunk_size:
            chunk_text = "\n\n".join(p["text"] for p in current_chunk_paras)
            chunks.append({
                "text": chunk_text,
                "page": current_page,
                "char_start": 0,
                "char_end": len(chunk_text),
                "source": "main",
            })

            # Overlap: keep last few paragraphs that fit in overlap budget
            overlap_paras: list[dict] = []
            overlap_tokens = 0
            for p in reversed(current_chunk_paras):
                if overlap_tokens + p["tokens"] > overlap:
                    break
                overlap_paras.insert(0, p)
                overlap_tokens += p["tokens"]

            current_chunk_paras = overlap_paras
            current_tokens = overlap_tokens

        if not current_chunk_paras:
            current_page = para["page"]

        current_chunk_paras.append(para)
        current_tokens += para_tokens

    # Final chunk
    if current_chunk_paras:
        chunk_text = "\n\n".join(p["text"] for p in current_chunk_paras)
        chunks.append({
            "text": chunk_text,
            "page": current_page,
            "char_start": 0,
            "char_end": len(chunk_text),
            "source": "main",
        })

    return chunks


def _chunk_si_text(si_text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """Chunk SI content using smart_slicer, then further split into token-limited chunks.

    Returns chunks with source="si" and section metadata.
    """
    if not si_text:
        return []

    slices = slice_si(si_text, max_chunk_tokens=chunk_size, overlap_tokens=overlap)
    chunks: list[dict] = []

    for s in slices:
        # The smart_slicer already produces reasonably-sized chunks,
        # but we may need to further split very large ones
        text = s.content
        tokens = _estimate_tokens(text)

        if tokens <= chunk_size * 1.5:
            chunks.append({
                "text": text,
                "page": 0,  # SI pages tracked separately
                "char_start": s.start_char,
                "char_end": s.end_char,
                "source": "si",
                "section": s.section_title,
                "has_table": s.has_table,
            })
        else:
            # Split large SI slices into smaller chunks
            sub_chunks = _chunk_text(text, chunk_size, overlap)
            for sc in sub_chunks:
                sc["source"] = "si"
                sc["section"] = s.section_title
                sc["has_table"] = s.has_table
                chunks.append(sc)

    return chunks


def _load_cached_index(doi: str) -> Optional[tuple]:
    """Try to load a persisted FAISS index from disk. Returns (index, chunks) or None."""
    safe_doi = doi.replace('/', '_')
    lit_index_path = os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.faiss")
    meta_path = os.path.join(_FAISS_DIR, "literature", f"{safe_doi}.json")

    if not (os.path.exists(lit_index_path) and os.path.exists(meta_path)):
        return None

    try:
        import faiss
        index = faiss.read_index(lit_index_path)
        with open(meta_path, 'r', encoding='utf-8') as f:
            chunks = json.load(f)
        return (index, chunks)
    except Exception as e:
        logger.warning(f"Failed to load cached index for {doi}: {e}")
        return None


def _persist_index(doi: str, index, chunks: list[dict]):
    """Persist FAISS index and chunk metadata to disk."""
    safe_doi = doi.replace('/', '_')
    lit_dir = os.path.join(_FAISS_DIR, "literature")
    os.makedirs(lit_dir, exist_ok=True)

    try:
        import faiss
        faiss.write_index(index, os.path.join(lit_dir, f"{safe_doi}.faiss"))
        with open(os.path.join(lit_dir, f"{safe_doi}.json"), 'w', encoding='utf-8') as f:
            json.dump(chunks, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed to persist FAISS index for {doi}: {e}")


async def _get_paper_markdown(doi: str, lit: Literature) -> tuple[str, str]:
    """Get markdown content for main text and SI.

    Returns (main_markdown, si_markdown).
    """
    main_markdown = ""
    si_markdown = ""

    # Main text
    if lit.local_pdf_path and os.path.exists(lit.local_pdf_path):
        main_markdown = await pdf_processor.convert_to_markdown(lit.local_pdf_path)

    # SI: check for SI file paths
    si_paths = []
    if lit.si_paths:
        try:
            si_paths = json.loads(lit.si_paths)
        except Exception:
            pass

    # Also check for SIFile records in DB
    if not si_paths:
        from .database import SIFile
        db = SessionLocal()
        try:
            si_files = db.query(SIFile).filter(
                SIFile.literature_doi == doi,
                SIFile.status == "ready",
            ).all()
            si_paths = [sf.local_path for sf in si_files if sf.local_path and os.path.exists(sf.local_path)]
        finally:
            db.close()

    for si_path in si_paths:
        if isinstance(si_path, str) and os.path.exists(si_path):
            try:
                si_content = await pdf_processor.convert_to_markdown(si_path)
                if si_content:
                    si_markdown += si_content + "\n\n"
            except Exception as e:
                logger.warning(f"Failed to parse SI file {si_path}: {e}")

    return main_markdown, si_markdown


def _build_fallback_text(lit: Literature) -> str:
    """Build fallback text from DB fields when PDF is unavailable."""
    parts = []
    if lit.title:
        parts.append(f"Title: {lit.title}")
    if lit.abstract:
        parts.append(f"Abstract: {lit.abstract}")
    if lit.performance_data:
        try:
            perf = json.loads(lit.performance_data)
            parts.append(f"Performance: {json.dumps(perf, ensure_ascii=False)}")
        except Exception:
            parts.append(f"Performance: {lit.performance_data}")
    if lit.process_params:
        try:
            proc = json.loads(lit.process_params)
            parts.append(f"Process: {json.dumps(proc, ensure_ascii=False)}")
        except Exception:
            parts.append(f"Process: {lit.process_params}")
    if lit.source_mapping:
        try:
            mapping = json.loads(lit.source_mapping)
            parts.append(f"Evidence: {json.dumps(mapping, ensure_ascii=False)}")
        except Exception:
            parts.append(f"Evidence: {lit.source_mapping}")
    return "\n\n".join(parts)


async def build_index_async(doi: str) -> Optional[tuple]:
    """Build FAISS index from paper content (main + SI).

    Uses async PDF parsing and includes SI content via smart_slicer.
    Returns (faiss_index, chunks_metadata) or None on failure.
    """
    # Check in-memory cache first
    with _cache_lock:
        if doi in _index_cache:
            return _index_cache[doi]

    # Check disk cache
    cached = _load_cached_index(doi)
    if cached is not None:
        with _cache_lock:
            _index_cache[doi] = cached
        return cached

    # Build from scratch
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            logger.warning(f"Literature {doi} not found in DB")
            return None

        # Get markdown content
        main_markdown, si_markdown = await _get_paper_markdown(doi, lit)

        # Fallback if no markdown available
        if not main_markdown:
            main_markdown = _build_fallback_text(lit)

        if not main_markdown:
            logger.warning(f"No content available for {doi}")
            return None

        # Chunk main text with page tracking
        chunks = _chunk_text(main_markdown)

        # Add SI chunks
        if si_markdown:
            si_chunks = _chunk_si_text(si_markdown)
            chunks.extend(si_chunks)

        if not chunks:
            logger.warning(f"No chunks generated for {doi}")
            return None

        logger.info(f"Built {len(chunks)} chunks for {doi} (main={sum(1 for c in chunks if c.get('source') != 'si')}, si={sum(1 for c in chunks if c.get('source') == 'si')})")

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
        _persist_index(doi, index, chunks)

        # Cache in memory
        with _cache_lock:
            _index_cache[doi] = (index, chunks)

        return (index, chunks)

    except Exception as e:
        logger.error(f"Failed to build index for {doi}: {e}")
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
        import faiss
        q_vector = np.array([q_embedding], dtype=np.float32)
        faiss.normalize_L2(q_vector)

        scores, indices = index.search(q_vector, TOP_K)

        # Gather relevant context with relevance filtering
        relevant_chunks = []
        for i, idx in enumerate(indices[0]):
            if 0 <= idx < len(chunks) and scores[0][i] >= MIN_RELEVANCE_SCORE:
                chunk = chunks[idx]
                relevant_chunks.append({
                    "text": chunk["text"],
                    "page": chunk.get("page", 1),
                    "score": float(scores[0][i]),
                    "source": chunk.get("source", "main"),
                    "section": chunk.get("section"),
                    "has_table": chunk.get("has_table", False),
                })

        if not relevant_chunks:
            yield {
                "type": "error",
                "message": "No relevant content found for this question in the paper.",
                "timestamp": datetime.datetime.now().isoformat(),
            }
            return

        # Step 3: Build context for LLM with page citations
        context_parts = []
        for rc in relevant_chunks:
            page_ref = f"[Page {rc['page']}" if rc['page'] > 0 else "[SI"
            if rc.get('section'):
                page_ref += f", {rc['section']}"
            page_ref += "]"
            context_parts.append(f"{page_ref} {rc['text']}")

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
                    {"role": "system", "content": "You are a precise scientific Q&A assistant. Answer based ONLY on the provided context. Always cite the page number. If the answer comes from Supporting Information, mention it."},
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

        # Step 5: Source citation events — emit all relevant sources
        sources = []
        for rc in relevant_chunks:
            source_event = {
                "page": rc["page"],
                "excerpt": rc["text"][:300],
                "file": rc.get("source", "main"),
                "relevance": round(rc["score"], 3),
            }
            if rc.get("section"):
                source_event["section"] = rc["section"]
            sources.append(source_event)

            yield {
                "type": "source",
                "timestamp": datetime.datetime.now().isoformat(),
                **source_event,
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
                source=json.dumps({
                    "primary_page": relevant_chunks[0]["page"],
                    "primary_excerpt": relevant_chunks[0]["text"][:300],
                    "sources": sources,
                }),
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
            return [
                "What is the main contribution of this paper?",
                "What materials are used in this study?",
                "What are the key performance metrics?",
            ]

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
            questions = re.findall(r'(?:\d+\.\s*|[-•]\s*)(.+?)(?:\n|$)', raw)
            if not questions:
                questions = [line.strip() for line in raw.strip().split('\n') if line.strip() and len(line.strip()) > 10]

            return questions[:5]

        except Exception as e:
            logger.error(f"Failed to generate suggestions: {e}")
            return [
                "What is the main contribution of this paper?",
                "What materials are used in this study?",
                "What are the key performance metrics?",
            ]

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
