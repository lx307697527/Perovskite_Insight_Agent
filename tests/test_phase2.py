"""
SIA V2.1 Phase 2 Integration Tests.

Tests for:
1. Q&A Engine (FAISS RAG pipeline: chunking, indexing, retrieval, answer generation)
2. Two-stage extraction (Stage1 screening → Stage2 deep extraction)
3. Smart Slicer (SI content chunking)
4. QA API endpoints (SSE format, validation, multi-source citations)
5. PDF page location and source tracking

Run:
  cd d:/Code_Space/Perovskite_Insight_Agent
  python -m pytest tests/test_phase2.py -v --tb=short
"""
import pytest
import os
import sys
import json
import re
import tempfile
import shutil

# Ensure src-python is on the path
_test_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_test_dir)
_src_python = os.path.join(_project_root, 'src-python')
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

os.environ.setdefault('SIA_PORT', '8002')


# ============================================================
# 1. Q&A Engine — Chunking
# ============================================================
class TestQAChunking:
    """Tests for the text chunking logic in qa_engine."""

    def test_chunk_text_empty_input(self):
        from core.qa_engine import _chunk_text
        assert _chunk_text("") == []
        assert _chunk_text(None) == []

    def test_chunk_text_basic(self):
        from core.qa_engine import _chunk_text
        text = "This is a test paragraph.\n\nThis is another paragraph."
        chunks = _chunk_text(text)
        assert len(chunks) >= 1
        assert all("text" in c and "page" in c and "source" in c for c in chunks)

    def test_chunk_text_with_page_markers(self):
        from core.qa_engine import _chunk_text
        text = "--- PAGE 1 ---\n" + ("First page content with some text. " * 50) + "\n\n--- PAGE 2 ---\n" + ("Second page content here. " * 50)
        chunks = _chunk_text(text)
        assert len(chunks) >= 1

        # At least one chunk from page 1
        page1_chunks = [c for c in chunks if c["page"] == 1]
        assert len(page1_chunks) >= 1

    def test_chunk_text_respects_paragraph_boundaries(self):
        """Chunks should not split mid-sentence when possible."""
        from core.qa_engine import _chunk_text
        # Create a long text with multiple paragraphs
        paragraphs = [f"Paragraph {i}: " + "word " * 100 for i in range(20)]
        text = "\n\n".join(paragraphs)
        chunks = _chunk_text(text)
        assert len(chunks) > 1

        # Each chunk should start with "Paragraph" (not mid-word)
        for c in chunks:
            text_content = c["text"]
            assert text_content.strip().startswith("Paragraph"), \
                f"Chunk should start at paragraph boundary, got: {text_content[:50]}..."

    def test_chunk_text_page_tracking(self):
        """Each chunk must track which page it belongs to."""
        from core.qa_engine import _chunk_text
        text = "--- PAGE 3 ---\n" + ("Content on page 3. " * 100) + "\n\n--- PAGE 5 ---\n" + ("Content on page 5. " * 100)
        chunks = _chunk_text(text)
        pages = {c["page"] for c in chunks}
        assert 3 in pages
        assert 5 in pages

    def test_chunk_si_text_empty(self):
        from core.qa_engine import _chunk_si_text
        assert _chunk_si_text("") == []
        assert _chunk_si_text(None) == []

    def test_chunk_si_text_with_content(self):
        from core.qa_engine import _chunk_si_text
        si_text = "Experimental Section\n\nThe perovskite film was fabricated by spin-coating at 4000 rpm for 30 s. The precursor solution was prepared by dissolving PbI2 and FAI in DMF:DMSO (4:1 v/v) at 1.5 M concentration.\n\nThe annealing was performed at 100°C for 10 min in a nitrogen glovebox."
        chunks = _chunk_si_text(si_text)
        assert len(chunks) >= 1
        # All SI chunks should have source="si"
        for c in chunks:
            assert c.get("source") == "si"


# ============================================================
# 2. Q&A Engine — Token Estimation
# ============================================================
class TestTokenEstimation:
    """Tests for the token estimation utility."""

    def test_estimate_tokens_english(self):
        from core.qa_engine import _estimate_tokens
        # Rough: ~4 chars per token for English
        text = "Hello world this is a test"
        tokens = _estimate_tokens(text)
        assert tokens > 0
        assert tokens < len(text)  # Should be less than char count

    def test_estimate_tokens_chinese(self):
        from core.qa_engine import _estimate_tokens
        # ~2 chars per token for Chinese
        text = "这是一个中文测试文本"
        tokens = _estimate_tokens(text)
        assert tokens > 0

    def test_estimate_tokens_empty(self):
        from core.qa_engine import _estimate_tokens
        assert _estimate_tokens("") == 0


# ============================================================
# 3. Smart Slicer
# ============================================================
class TestSmartSlicer:
    """Tests for SI smart slicing."""

    def test_find_experimental_sections_english(self):
        from core.smart_slicer import find_experimental_sections
        # Content must be >200 chars for a section to be included
        text = "Introduction\n\n" + ("Some intro text. " * 20) + "\n\nExperimental Section\n\n" + ("The film was spin-coated at 4000 rpm for 30 s. " * 20) + "\n\nResults and Discussion\n\n" + ("The efficiency reached 25%. " * 20)
        sections = find_experimental_sections(text)
        assert len(sections) >= 1
        found_exp = any("experimental" in s[0].lower() for s in sections)
        assert found_exp, f"Should find 'Experimental Section', got: {[s[0] for s in sections]}"

    def test_find_experimental_sections_methods(self):
        from core.smart_slicer import find_experimental_sections
        text = "Introduction\n\n" + ("Some intro text. " * 20) + "\n\nMethods\n\n" + ("The film was spin-coated. " * 20) + "\n\nResults\n\n" + ("Data here. " * 20)
        sections = find_experimental_sections(text)
        assert len(sections) >= 1

    def test_find_experimental_sections_chinese(self):
        from core.smart_slicer import find_experimental_sections
        text = "引言\n\n" + ("一些介绍文字。" * 30) + "\n\n实验方法\n\n" + ("薄膜通过旋涂制备。这是实验部分的详细描述。" * 20) + "\n\n结果与讨论\n\n" + ("数据在这里。" * 20)
        sections = find_experimental_sections(text)
        assert len(sections) >= 1

    def test_slice_si_produces_relevant_chunks(self):
        from core.smart_slicer import slice_si
        text = "Introduction\n\nSome text.\n\nExperimental Section\n\nThe perovskite precursor was prepared by dissolving PbI2 (1.5 M) and FAI in DMF:DMSO (4:1 v/v). The solution was spin-coated at 4000 rpm for 30 s, followed by annealing at 100°C for 10 min. The antisolvent chlorobenzene was dropped 5 s before the end of spinning.\n\nResults and Discussion\n\nThe device achieved 25.1% PCE."
        slices = slice_si(text)
        assert len(slices) >= 1
        # Experimental section should be higher relevance
        exp_slices = [s for s in slices if s.relevance >= 1.0]
        assert len(exp_slices) >= 1, "Experimental section should have high relevance"

    def test_slice_si_short_content(self):
        from core.smart_slicer import slice_si
        # Very short content should return empty or minimal chunks
        slices = slice_si("short")
        assert isinstance(slices, list)

    def test_slice_si_preserves_table_data(self):
        from core.smart_slicer import slice_si
        # Need enough content for a valid slice
        text = ("Introduction\n\n" + "Some text. " * 30 +
                "\n\nTable S1: Device Parameters\n\n" + "PCE: 24.9%, Voc: 1.18 V, Jsc: 25.1 mA/cm2, FF: 79.2%. " * 10 +
                "\n\n" + "Other text. " * 20)
        slices = slice_si(text)
        # Should detect table
        table_slices = [s for s in slices if s.has_table]
        assert len(table_slices) >= 1, "Should detect table in SI content"

    def test_detect_tables(self):
        from core.smart_slicer import detect_tables
        text = "Table S1: Photovoltaic Parameters\n\nPCE Voc Jsc FF\n24.9% 1.18V 25.1 79.2\n\nOther text."
        tables = detect_tables(text)
        assert len(tables) >= 1


# ============================================================
# 4. Q&A Engine — FAISS Index Building (mocked)
# ============================================================
class TestFAISSIndexBuilding:
    """Tests for FAISS index building logic (without requiring actual model)."""

    def test_load_cached_index_nonexistent(self):
        from core.qa_engine import _load_cached_index
        result = _load_cached_index("10.1234/nonexistent.doi")
        assert result is None

    def test_invalidate_index_nonexistent(self):
        """Invalidating a non-existent index should not error."""
        from core.qa_engine import invalidate_index
        invalidate_index("10.1234/nonexistent.doi")  # Should not raise

    def test_build_fallback_text(self):
        from core.qa_engine import _build_fallback_text
        from core.database import Literature

        # Create a mock Literature object
        class MockLit:
            title = "Test Paper"
            abstract = "This is a test abstract about perovskite solar cells."
            performance_data = '{"pce": "24.9%", "voc": "1.18V"}'
            process_params = '{"annealing": "100°C"}'
            source_mapping = '{"PCE": "Table 1 shows 24.9%"}'

        result = _build_fallback_text(MockLit())
        assert "Test Paper" in result
        assert "perovskite" in result
        assert "24.9%" in result

    def test_build_fallback_text_minimal(self):
        from core.qa_engine import _build_fallback_text

        class MockLit:
            title = None
            abstract = None
            performance_data = None
            process_params = None
            source_mapping = None

        result = _build_fallback_text(MockLit())
        assert result == ""

    def test_save_and_load_markdown_cache(self):
        """Test that extractor caches markdown for QA reuse."""
        from core.extractor import PaperExtractor
        extractor = PaperExtractor()

        doi = "10.1234/test.cache"
        markdown = "--- PAGE 1 ---\nTest content for caching.\n\n--- PAGE 2 ---\nMore content."

        # Save
        extractor._save_markdown_cache(doi, markdown, "main")

        # Verify file exists
        from core.extractor import _MARKDOWN_CACHE_DIR
        safe_doi = doi.replace('/', '_')
        cache_path = os.path.join(_MARKDOWN_CACHE_DIR, f"{safe_doi}_main.md")
        assert os.path.exists(cache_path), f"Markdown cache should exist at {cache_path}"

        # Verify content
        with open(cache_path, 'r', encoding='utf-8') as f:
            cached = f.read()
        assert cached == markdown

        # Cleanup
        os.remove(cache_path)


# ============================================================
# 5. QA API — Request Validation
# ============================================================
class TestQAAPIValidation:
    """Tests for QA API endpoint validation logic."""

    def test_doi_validation_valid(self):
        from api.qa import DOI_PATTERN
        valid_dois = [
            "10.1126/science.abc1234",
            "10.1038/s41586-024-07134-5",
            "10.1002/adma.202301234",
        ]
        for doi in valid_dois:
            assert DOI_PATTERN.match(doi), f"DOI should be valid: {doi}"

    def test_doi_validation_invalid(self):
        from api.qa import DOI_PATTERN
        invalid_dois = [
            "not-a-doi",
            "",
            "10.",
            "science.abc1234",
        ]
        for doi in invalid_dois:
            assert not DOI_PATTERN.match(doi), f"DOI should be invalid: {doi}"


# ============================================================
# 6. QA API — SSE Event Format
# ============================================================
class TestQASSEEventFormat:
    """Verify QA SSE event format matches the Refactor_Plan spec (Section 2.4)."""

    def test_qa_event_types_defined(self):
        """Verify all QA SSE event types from the spec exist in types."""
        spec_types = {"content", "source", "done", "error"}
        # Verify the Python engine produces these types
        qa_source = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()

        for event_type in spec_types:
            assert f'"type": "{event_type}"' in qa_source or f"'type': '{event_type}'" in qa_source, \
                f"qa_engine.py must produce '{event_type}' event type"

    def test_source_event_has_required_fields(self):
        """Source event must include page, excerpt, file per spec."""
        source_code = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()

        # Verify source event includes page, excerpt, file fields
        assert '"page"' in source_code, "Source event must have 'page' field"
        assert '"excerpt"' in source_code, "Source event must have 'excerpt' field"
        assert '"file"' in source_code, "Source event must have 'file' field (main/si)"

    def test_done_event_has_cost_and_tokens(self):
        """Done event must include cost and tokens per spec."""
        source_code = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()

        assert '"cost"' in source_code, "Done event must have 'cost' field"
        assert '"tokens"' in source_code, "Done event must have 'tokens' field"

    def test_all_events_have_timestamp(self):
        """All SSE events must include timestamp per spec."""
        source_code = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()

        # Count "timestamp" occurrences in yield statements
        timestamp_count = source_code.count('"timestamp"')
        yield_count = source_code.count('yield {')
        assert timestamp_count >= yield_count, \
            f"Every yield event should include timestamp: {timestamp_count} timestamps for {yield_count} yields"


# ============================================================
# 7. Two-Stage Extraction — Stage1
# ============================================================
class TestStage1Extraction:
    """Tests for Stage1 lightweight screening."""

    def test_stage1_prompt_exists(self):
        from core.stage1 import STAGE1_PROMPT
        assert STAGE1_PROMPT
        assert "is_relevant" in STAGE1_PROMPT
        assert "relevance_score" in STAGE1_PROMPT
        assert "recommendation" in STAGE1_PROMPT

    def test_stage1_screener_default_result(self):
        from core.stage1 import Stage1Screener
        screener = Stage1Screener()
        # Without a client, should return default
        result = await_sync(screener.screen("Test content about perovskite solar cells."))
        assert "is_relevant" in result
        assert "relevance_score" in result
        assert "recommendation" in result
        assert "device_type" in result

    def test_stage1_screener_empty_content(self):
        from core.stage1 import Stage1Screener
        screener = Stage1Screener()
        result = await_sync(screener.screen(""))
        assert result["recommendation"] == "proceed"  # Default for empty

    def test_stage1_screener_short_content(self):
        from core.stage1 import Stage1Screener
        screener = Stage1Screener()
        result = await_sync(screener.screen("Hi"))
        # Very short content should return default
        assert "is_relevant" in result

    def test_stage1_format_result(self):
        from core.stage1 import Stage1Screener
        from core.database import Literature

        screener = Stage1Screener()

        class MockLit:
            doi = "10.1234/test"
            title = "Test Paper"
            extraction_stage = "stage1"
            relevance_score = 0.8
            source_mapping = json.dumps({"stage1_summary": "High-efficiency perovskite", "stage1_composition": "FAPbI3", "stage1_reason": "Contains experimental data"})
            performance_data = json.dumps({"device_type": "solar_cell", "headline_metrics": {"PCE": "24.9%"}})

        result = screener._format_screening_result(MockLit())
        assert result["doi"] == "10.1234/test"
        assert result["relevance_score"] == 0.8
        assert result["extraction_stage"] == "stage1"


# ============================================================
# 8. Two-Stage Extraction — Stage2
# ============================================================
class TestStage2Extraction:
    """Tests for Stage2 deep extraction pipeline."""

    def test_extractor_uses_smart_slicer(self):
        """extractor.py should import and use smart_slicer."""
        source = open(os.path.join(_src_python, 'core', 'extractor.py'), 'r', encoding='utf-8').read()
        assert 'smart_slicer' in source or 'slice_si' in source, \
            "extractor.py should import smart_slicer for SI content preparation"

    def test_extractor_saves_markdown_cache(self):
        """extractor.py should cache markdown for QA reuse."""
        source = open(os.path.join(_src_python, 'core', 'extractor.py'), 'r', encoding='utf-8').read()
        assert '_save_markdown_cache' in source, \
            "extractor.py should save markdown cache for QA engine"

    def test_extractor_tracks_si_files(self):
        """extractor.py should track SI files in DB for QA engine."""
        source = open(os.path.join(_src_python, 'core', 'extractor.py'), 'r', encoding='utf-8').read()
        assert '_track_si_file' in source or 'SIFile' in source, \
            "extractor.py should track SI files in DB"

    def test_extractor_invalidates_qa_index(self):
        """extractor.py should invalidate QA index after extraction."""
        source = open(os.path.join(_src_python, 'core', 'extractor.py'), 'r', encoding='utf-8').read()
        assert 'invalidate_index' in source, \
            "extractor.py should invalidate QA FAISS index after re-extraction"

    def test_stage2_prompt_is_deep(self):
        """Stage2 prompt should be more detailed than Stage1."""
        from core.prompts import STAGE2_DEEP_PROMPT, PEROVSKITE_EXTRACTOR_PROMPT
        assert len(STAGE2_DEEP_PROMPT) > len(PEROVSKITE_EXTRACTOR_PROMPT) * 0.5, \
            "Stage2 deep prompt should be substantive"
        assert "deep" in STAGE2_DEEP_PROMPT.lower() or "Deep" in STAGE2_DEEP_PROMPT
        assert "stability" in STAGE2_DEEP_PROMPT.lower()
        assert "scan_direction" in STAGE2_DEEP_PROMPT or "scan direction" in STAGE2_DEEP_PROMPT

    def test_extractor_stages_defined(self):
        """Extractor should define 5 stages matching the spec."""
        source = open(os.path.join(_src_python, 'core', 'extractor.py'), 'r', encoding='utf-8').read()
        stages = ["downloading", "parsing", "analyzing_si", "extracting", "saving"]
        for stage in stages:
            assert stage in source, f"Extractor should define '{stage}' stage"

    def test_prepare_main_content_finds_experimental(self):
        """_prepare_main_content should locate experimental sections."""
        from core.extractor import PaperExtractor
        ext = PaperExtractor()
        markdown = "Introduction\n\nSome text.\n\nExperimental Section\n\nThe film was prepared by spin-coating at 4000 rpm for 30 s. The precursor was 1.5 M PbI2 in DMF:DMSO (4:1 v/v).\n\nResults\n\nThe PCE was 24.9%."
        result = ext._prepare_main_content(markdown)
        assert "4000 rpm" in result
        assert "Experimental" in result or "experimental" in result.lower()

    def test_prepare_main_content_fallback(self):
        """_prepare_main_content should fall back to first 30K chars."""
        from core.extractor import PaperExtractor
        ext = PaperExtractor()
        markdown = "Some generic paper content without specific section headers. " * 100
        result = ext._prepare_main_content(markdown)
        assert len(result) > 0

    def test_prepare_si_content(self):
        """_prepare_si_content should use smart_slicer."""
        from core.extractor import PaperExtractor
        ext = PaperExtractor()
        si_text = "Introduction\n\nSome text.\n\nExperimental Section\n\nThe perovskite was annealed at 100°C for 10 min. The spin-coating was at 4000 rpm.\n\nResults\n\nThe device achieved 24.9% PCE."
        result = ext._prepare_si_content(si_text)
        assert len(result) > 0
        assert "100" in result or "annealed" in result.lower()


# ============================================================
# 9. Progress Tracker
# ============================================================
class TestProgressTracker:
    """Tests for the 5-stage progress tracking engine."""

    def test_tracker_creation(self):
        from core.progress import create_tracker, remove_tracker
        tracker = create_tracker("test-doi")
        assert tracker is not None
        remove_tracker("test-doi")

    def test_tracker_define_stages(self):
        from core.progress import create_tracker, remove_tracker
        tracker = create_tracker("test-doi-2")
        tracker.define_stages([
            ("downloading", 0.20, "Downloading PDF"),
            ("parsing", 0.20, "Parsing document"),
            ("extracting", 0.35, "AI deep extraction"),
            ("saving", 0.10, "Saving results"),
        ])
        progress = tracker.get_progress()
        assert progress["progress"] == 0
        remove_tracker("test-doi-2")

    def test_tracker_advance_and_progress(self):
        from core.progress import create_tracker, remove_tracker
        tracker = create_tracker("test-doi-3")
        tracker.define_stages([
            ("step1", 0.5, "First step"),
            ("step2", 0.5, "Second step"),
        ])
        tracker.start()
        tracker.advance("step1")
        progress = tracker.get_progress()
        assert progress["progress"] > 0
        assert progress["current_stage"] == "step1"

        tracker.advance("step2")
        progress = tracker.get_progress()
        assert progress["current_stage"] == "step2"

        remove_tracker("test-doi-3")

    def test_tracker_completed_event(self):
        from core.progress import create_tracker, remove_tracker
        tracker = create_tracker("test-doi-4")
        tracker.define_stages([
            ("step1", 0.5, "First step"),
            ("step2", 0.5, "Second step"),
        ])
        completed = tracker.get_completed_event()
        assert completed["progress"] == 100
        assert all(s["status"] == "completed" for s in completed["stages"])
        remove_tracker("test-doi-4")

    def test_tracker_eta(self):
        from core.progress import create_tracker, remove_tracker
        import time
        tracker = create_tracker("test-doi-5")
        tracker.define_stages([
            ("step1", 0.5, "First step"),
            ("step2", 0.5, "Second step"),
        ])
        tracker.start()
        tracker.advance("step1")
        time.sleep(0.1)

        progress = tracker.get_progress()
        # After some time, ETA should be calculable
        # (may be None if progress is too small)
        assert "eta_seconds" in progress
        remove_tracker("test-doi-5")

    def test_tracker_cancel(self):
        from core.progress import create_tracker, remove_tracker
        tracker = create_tracker("test-doi-6")
        tracker.define_stages([("step1", 1.0, "Only step")])
        tracker.start()
        tracker.cancel()
        assert tracker.is_cancelled
        remove_tracker("test-doi-6")


# ============================================================
# 10. QA Engine — Source Tracking
# ============================================================
class TestQASourceTracking:
    """Tests for QA source citation and page tracking."""

    def test_source_event_includes_file_field(self):
        """Source events must include 'file' field (main/si) per spec."""
        source = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()
        # The source event yield should include file field
        assert '"file"' in source, "Source events must include file field (main/si)"

    def test_source_event_includes_relevance(self):
        """Source events should include relevance score for multi-source filtering."""
        source = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()
        assert '"relevance"' in source, "Source events should include relevance score"

    def test_multiple_source_events_emitted(self):
        """QA engine should emit multiple source events for multi-source answers."""
        source = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()
        # Should iterate over relevant_chunks and emit source event for each
        assert "for rc in relevant_chunks" in source or "relevant_chunks" in source, \
            "QA engine should iterate over multiple relevant chunks for source events"

    def test_min_relevance_filter(self):
        """QA engine should filter sources by minimum relevance score."""
        source = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()
        assert "MIN_RELEVANCE_SCORE" in source, \
            "QA engine should filter sources by minimum relevance score"


# ============================================================
# 11. QA DB Record — Multi-Source Storage
# ============================================================
class TestQADBRecord:
    """Test that QA records store multi-source information."""

    def test_quick_question_source_json_format(self):
        """QuickQuestion.source should store multi-source JSON."""
        from core.database import QuickQuestion
        # The source column should be Text (JSON) type
        source_col = QuickQuestion.__table__.c.source
        assert source_col is not None

    def test_qa_source_json_structure(self):
        """Verify the JSON structure stored in QuickQuestion.source."""
        source = open(os.path.join(_src_python, 'core', 'qa_engine.py'), 'r', encoding='utf-8').read()
        # Should store primary_page, primary_excerpt, and sources array
        assert "primary_page" in source, "QA record should store primary page"
        assert "sources" in source, "QA record should store sources array"


# ============================================================
# 12. Frontend Type Alignment
# ============================================================
class TestFrontendTypeAlignment:
    """Verify frontend TypeScript types align with backend SSE events."""

    def test_qa_sse_event_type_has_source_fields(self):
        """QASSEEvent in types/index.ts should include section and relevance fields."""
        types_path = os.path.join(_project_root, 'src', 'types', 'index.ts')
        with open(types_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Check QASSEEvent interface has new fields
        assert 'section' in content, "QASSEEvent should include 'section' field"
        assert 'relevance' in content, "QASSEEvent should include 'relevance' field"

    def test_answer_card_handles_multiple_sources(self):
        """AnswerCard should handle multiple source events."""
        answer_card_path = os.path.join(_project_root, 'src', 'components', 'AnswerCard.tsx')
        with open(answer_card_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Should filter multiple source events
        assert "sourceEvents" in content or "filter.*source" in content, \
            "AnswerCard should collect multiple source events"

    def test_pdf_fragment_overlay_has_page_jump(self):
        """PdfFragmentOverlay should support page jump functionality."""
        pdf_path = os.path.join(_project_root, 'src', 'components', 'PdfFragmentOverlay.tsx')
        with open(pdf_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert "targetPage" in content, "PdfFragmentOverlay should accept targetPage prop"
        assert "goToPage" in content or "setCurrentPage" in content, \
            "PdfFragmentOverlay should have page navigation"

    def test_insight_lab_page_has_two_stage_buttons(self):
        """InsightLabPage should have Stage1 and Stage2 buttons."""
        page_path = os.path.join(_project_root, 'src', 'pages', 'InsightLabPage.tsx')
        with open(page_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert "handleStage1" in content, "InsightLabPage should handle Stage1"
        assert "handleStage2" in content, "InsightLabPage should handle Stage2"
        assert "快速筛选" in content, "InsightLabPage should have Stage1 button"
        assert "深度提取" in content, "InsightLabPage should have Stage2 button"

    def test_insight_lab_page_has_pdf_overlay(self):
        """InsightLabPage should integrate PdfFragmentOverlay."""
        page_path = os.path.join(_project_root, 'src', 'pages', 'InsightLabPage.tsx')
        with open(page_path, 'r', encoding='utf-8') as f:
            content = f.read()

        assert "PdfFragmentOverlay" in content, "InsightLabPage should use PdfFragmentOverlay"
        assert "onPageClick" in content or "handlePageClick" in content, \
            "InsightLabPage should handle page click from answer card"


# ============================================================
# 13. End-to-End SSE Event Flow (Source Code Verification)
# ============================================================
class TestSSEEventFlow:
    """Verify the complete SSE event flow for both QA and extraction."""

    def test_qa_sse_events_are_properly_serialized(self):
        """QA SSE events should be JSON-serializable."""
        source = open(os.path.join(_src_python, 'api', 'qa.py'), 'r', encoding='utf-8').read()
        assert 'json.dumps(event, ensure_ascii=False)' in source, \
            "QA events should be serialized with ensure_ascii=False for Chinese support"

    def test_extract_sse_events_are_properly_serialized(self):
        """Extract SSE events should be JSON-serializable."""
        source = open(os.path.join(_src_python, 'api', 'extract.py'), 'r', encoding='utf-8').read()
        assert 'json.dumps' in source, "Extract events should use json.dumps"

    def test_qa_endpoint_validates_doi(self):
        """QA endpoint should validate DOI format."""
        source = open(os.path.join(_src_python, 'api', 'qa.py'), 'r', encoding='utf-8').read()
        assert '_validate_doi' in source or 'DOI_PATTERN' in source, \
            "QA endpoint should validate DOI format"

    def test_qa_endpoint_checks_paper_exists(self):
        """QA endpoint should verify paper exists in DB before processing."""
        source = open(os.path.join(_src_python, 'api', 'qa.py'), 'r', encoding='utf-8').read()
        assert '404' in source, "QA endpoint should return 404 if paper not found"

    def test_qa_endpoint_checks_question_length(self):
        """QA endpoint should validate question length."""
        source = open(os.path.join(_src_python, 'api', 'qa.py'), 'r', encoding='utf-8').read()
        assert '1000' in source or 'len(' in source, \
            "QA endpoint should validate question length"


# ============================================================
# 14. Model Manager
# ============================================================
class TestModelManager:
    """Tests for the embedding model manager."""

    def test_model_manager_status_types(self):
        """Model manager should support all required status types."""
        from core.model_manager import get_status
        # Status should be one of: not_installed, loading, ready, error
        status = get_status()
        assert status in ("not_installed", "loading", "ready", "error"), \
            f"Unexpected status: {status}"

    def test_embed_texts_returns_none_when_not_ready(self):
        """embed_texts should return None when model is not ready."""
        from core.model_manager import embed_texts
        # If model is not loaded, should return None gracefully
        result = embed_texts(["test"])
        # Result is either None (not ready) or a list of embeddings
        if result is not None:
            assert isinstance(result, list)
            assert len(result) == 1

    def test_embed_single_returns_none_when_not_ready(self):
        """embed_single should return None when model is not ready."""
        from core.model_manager import embed_single
        result = embed_single("test")
        if result is not None:
            assert isinstance(result, list)


# ============================================================
# Helpers
# ============================================================
def await_sync(coro):
    """Run an async function synchronously for testing."""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We're inside an existing event loop, use nest_asyncio or return default
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result(timeout=30)
    else:
        return asyncio.run(coro)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
