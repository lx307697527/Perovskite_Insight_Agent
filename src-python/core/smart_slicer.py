"""
SI (Supporting Information) smart slicer for SIA V2.1.

Locates experimental/methods sections in SI documents and extracts
the most relevant chunks for deep extraction. This replaces the
simple string-search approach in the old extractor.py.
"""

import re
import logging
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Anchors that mark the start of experimental sections
SECTION_ANCHORS = [
    # English anchors
    r"(?i)(?:experimental\s*(?:section|details|procedures?|methods?)\b)",
    r"(?i)(?:(?:materials?\s+and\s+)?methods?\b)",
    r"(?i)(?:synthesis\s+(?:of|procedures?)?\b)",
    r"(?i)(?:fabrication\s+(?:of|procedures?)?\b)",
    r"(?i)(?:device\s+(?:fabrication|preparation|assembly)\b)",
    r"(?i)(?:sample\s+preparation\b)",
    r"(?i)(?:perovskite\s+(?:film|layer|preparation)\b)",
    r"(?i)(?:film\s+deposition\b)",
    r"(?i)(?:deposition\s+(?:of|process)\b)",
    # Chinese anchors
    r"实验(?:部分|方法|细节|步骤)",
    r"材料(?:与|和)方法",
    r"制备方法",
    r"器件制备",
    r"样品制备",
]

# Anchors that mark the END of experimental sections (start of next major section)
SECTION_END_ANCHORS = [
    r"(?i)(?:characteri[sz]ation\b)",
    r"(?i)(?:measurements?\b)",
    r"(?i)(?:results?\s+(?:and\s+)?discussion\b)",
    r"(?i)(?:theoretical\s+(?:section|calculations?|analysis)\b)",
    r"(?i)(?:computational\s+(?:details|methods)\b)",
    r"(?i)(?:supplementary\s+(?:notes?|figures?|tables?)\b)",
    r"(?i)(?:acknowledg(?:ements?|ments?)\b)",
    r"(?i)(?:references?\b)",
    r"(?i)(?:data\s+availability\b)",
    r"表征(?:方法)?",
    r"结果(?:与|和)讨论",
    r"补充(?:材料|图|表)",
]

# Key tables to look for
TABLE_PATTERNS = [
    r"(?i)table\s+s?\d*[\.:]\s*",
    r"(?i)(?:photovoltaic|device|performance)\s+parameters",
    r"(?i)(?:summary\s+of\s+(?:device|photovoltaic|performance))",
]


@dataclass
class SISlice:
    """A chunk of SI content with metadata."""
    content: str
    section_title: str
    start_char: int
    end_char: int
    has_table: bool = False
    relevance: float = 1.0  # 0-1, higher = more relevant


def find_experimental_sections(text: str) -> list[tuple[str, int, int]]:
    """Find experimental section boundaries in the text.

    Returns list of (section_title, start_char, end_char).
    """
    sections = []

    for pattern in SECTION_ANCHORS:
        for match in re.finditer(pattern, text):
            start = match.start()
            # Capture the full line as section title
            line_start = text.rfind("\n", 0, start) + 1
            line_end = text.find("\n", start)
            if line_end == -1:
                line_end = len(text)
            section_title = text[line_start:line_end].strip()

            # Find the end of this section
            end = len(text)
            for end_pattern in SECTION_END_ANCHORS:
                end_match = re.search(end_pattern, text[start + len(match.group()):])
                if end_match:
                    candidate_end = start + len(match.group()) + end_match.start()
                    if candidate_end < end:
                        end = candidate_end

            # Only include if the section has substantial content (>200 chars)
            if end - start > 200:
                sections.append((section_title, start, end))

    return sections


def detect_tables(text: str) -> list[tuple[int, int]]:
    """Detect table regions in text. Returns list of (start, end) char offsets."""
    tables = []
    for pattern in TABLE_PATTERNS:
        for match in re.finditer(pattern, text):
            # Extend to end of table (next blank line or next section header)
            start = match.start()
            end = start + 2000  # Max table length
            next_blank = text.find("\n\n", start + len(match.group()))
            if next_blank != -1 and next_blank < end:
                end = next_blank
            tables.append((start, min(end, len(text))))
    return tables


def slice_si(text: str, max_chunk_tokens: int = 4000, overlap_tokens: int = 200) -> list[SISlice]:
    """Slice SI content into meaningful chunks for AI extraction.

    Strategy:
    1. Find experimental sections using anchor patterns
    2. Extract those sections as high-priority chunks
    3. For remaining content, create overlapping chunks
    4. Detect and include relevant tables

    Args:
        text: Full SI text content
        max_chunk_tokens: Approximate max tokens per chunk (~4 chars/token for English)
        overlap_tokens: Overlap between chunks in tokens

    Returns:
        List of SISlice objects sorted by relevance (highest first)
    """
    if not text or len(text.strip()) < 100:
        return []

    max_chars = max_chunk_tokens * 4  # rough token-to-char ratio
    overlap_chars = overlap_tokens * 4

    slices: list[SISlice] = []
    table_regions = detect_tables(text)

    # 1. Extract experimental sections (high relevance)
    exp_sections = find_experimental_sections(text)
    covered_ranges: list[tuple[int, int]] = []

    for title, start, end in exp_sections:
        content = text[start:end]
        if len(content) > max_chars:
            # Split large sections into chunks
            chunks = _split_into_chunks(content, max_chars, overlap_chars)
            for i, chunk in enumerate(chunks):
                chunk_start = start + chunk[0]
                chunk_end = start + chunk[1]
                has_table = any(
                    ts < chunk_end and te > chunk_start for ts, te in table_regions
                )
                slices.append(SISlice(
                    content=text[chunk_start:chunk_end],
                    section_title=f"{title} (part {i+1})",
                    start_char=chunk_start,
                    end_char=chunk_end,
                    has_table=has_table,
                    relevance=1.0,
                ))
                covered_ranges.append((chunk_start, chunk_end))
        else:
            has_table = any(
                ts < end and te > start for ts, te in table_regions
            )
            slices.append(SISlice(
                content=content,
                section_title=title,
                start_char=start,
                end_char=end,
                has_table=has_table,
                relevance=1.0,
            ))
            covered_ranges.append((start, end))

    # 2. Extract tables not already covered
    for table_start, table_end in table_regions:
        if any(cs <= table_start and ce >= table_end for cs, ce in covered_ranges):
            continue  # Already covered by an experimental section

        # Extend table context a bit
        ctx_start = max(0, table_start - 200)
        ctx_end = min(len(text), table_end + 200)
        slices.append(SISlice(
            content=text[ctx_start:ctx_end],
            section_title="Table data",
            start_char=ctx_start,
            end_char=ctx_end,
            has_table=True,
            relevance=0.8,
        ))

    # 3. If no experimental sections found, chunk the entire text
    if not exp_sections:
        chunks = _split_into_chunks(text, max_chars, overlap_chars)
        for i, (start, end) in enumerate(chunks):
            has_table = any(
                ts < end and te > start for ts, te in table_regions
            )
            slices.append(SISlice(
                content=text[start:end],
                section_title=f"SI Content (chunk {i+1})",
                start_char=start,
                end_char=end,
                has_table=has_table,
                relevance=0.6,
            ))

    # Sort by relevance (highest first)
    slices.sort(key=lambda s: s.relevance, reverse=True)

    logger.info(f"SI slicer produced {len(slices)} chunks from {len(text)} chars")
    return slices


def _split_into_chunks(
    text: str, max_chars: int, overlap_chars: int
) -> list[tuple[int, int]]:
    """Split text into overlapping chunks, breaking at paragraph boundaries.

    Returns list of (start_char, end_char) tuples.
    """
    chunks = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = start + max_chars

        if end >= text_len:
            chunks.append((start, text_len))
            break

        # Try to break at paragraph boundary
        paragraph_break = text.rfind("\n\n", start + max_chars // 2, end)
        if paragraph_break != -1:
            end = paragraph_break

        chunks.append((start, end))

        # Next chunk starts with overlap
        start = end - overlap_chars
        if start <= chunks[-1][0]:
            start = end  # Avoid infinite loop

    return chunks
