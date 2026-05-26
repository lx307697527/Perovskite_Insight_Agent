"""
Unit tests for core/progress.py

Covers: ProgressTracker lifecycle, stage advancement, ETA calculation,
cancellation, global tracker registry.

Test case: ALG-07
"""

import time
import pytest
from core.progress import (
    ProgressTracker,
    create_tracker,
    get_tracker,
    remove_tracker,
)


class TestProgressTrackerLifecycle:
    """ALG-07: Basic tracker lifecycle."""

    def test_01_define_and_start(self):
        """Define stages and start — first stage is active."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.1, "下载 PDF"),
            ("parsing", 0.2, "解析文档结构"),
            ("extracting", 0.7, "AI 提取"),
        ])
        tracker.start()

        progress = tracker.get_progress()
        assert progress["progress"] > 0
        assert progress["current_stage"] == "download"
        assert progress["current_label"] == "下载 PDF"
        assert len(progress["stages"]) == 3
        assert progress["stages"][0]["status"] == "active"
        assert progress["stages"][1]["status"] == "pending"

    def test_02_advance_stages(self):
        """Advance through all stages — completed state."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.2, "下载 PDF"),
            ("parsing", 0.3, "解析文档结构"),
            ("extracting", 0.5, "AI 提取"),
        ])
        tracker.start()
        time.sleep(0.05)

        tracker.advance()  # download → parsing
        time.sleep(0.05)
        tracker.advance()  # parsing → extracting
        time.sleep(0.05)
        tracker.advance()  # extracting → end

        progress = tracker.get_progress()
        assert progress["stages"][0]["status"] == "completed"
        assert progress["stages"][1]["status"] == "completed"
        assert progress["stages"][2]["status"] == "completed"

    def test_03_completed_event(self):
        """get_completed_event returns 100% progress."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.3, "下载 PDF"),
            ("extracting", 0.7, "AI 提取"),
        ])
        tracker.start()
        tracker.advance()
        completed = tracker.get_completed_event()

        assert completed["progress"] == 100
        assert completed["eta_seconds"] == 0
        assert all(s["status"] == "completed" for s in completed["stages"])


class TestProgressTrackerETA:
    """ETA estimation."""

    def test_04_eta_after_completion(self):
        """ETA is calculated after at least one stage completes."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.2, "下载 PDF"),
            ("parsing", 0.3, "解析文档结构"),
            ("extracting", 0.5, "AI 提取"),
        ])
        tracker.start()
        time.sleep(0.1)
        tracker.advance()  # download completed

        progress = tracker.get_progress()
        # After one stage completes, ETA should be calculated
        assert progress["eta_seconds"] is not None
        assert progress["eta_seconds"] >= 0

    def test_05_no_eta_before_first_stage(self):
        """No ETA before any stage completes."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.2, "下载 PDF"),
            ("extracting", 0.8, "AI 提取"),
        ])
        tracker.start()
        # Immediately — no stage completed yet
        progress = tracker.get_progress()
        assert progress["eta_seconds"] is None

    def test_06_progress_capped_at_99(self):
        """Progress percentage capped at 99 (not 100) during active tracking."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.5, "下载 PDF"),
            ("extracting", 0.5, "AI 提取"),
        ])
        tracker.start()
        time.sleep(0.05)
        tracker.advance()  # first stage done → 50%
        time.sleep(0.05)
        tracker.advance()  # second stage done

        progress = tracker.get_progress()
        # After all stages complete via advance(), the last stage
        # doesn't have end_time set until get_completed_event is called
        assert progress["progress"] <= 99


class TestProgressTrackerCancel:
    """Cancellation behavior."""

    def test_07_cancel_tracker(self):
        """Cancel a running tracker."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.5, "下载 PDF"),
            ("extracting", 0.5, "AI 提取"),
        ])
        tracker.start()
        tracker.cancel()

        assert tracker.is_cancelled is True

    def test_08_advance_after_cancel(self):
        """Advancing a cancelled tracker does nothing."""
        tracker = ProgressTracker()
        tracker.define_stages([
            ("download", 0.5, "下载 PDF"),
            ("extracting", 0.5, "AI 提取"),
        ])
        tracker.start()
        tracker.cancel()
        tracker.advance()  # should be no-op

        progress = tracker.get_progress()
        # First stage should still be active (advance was no-op)
        assert progress["stages"][0]["status"] == "active"


class TestProgressTrackerEmpty:
    """Edge cases with empty or uninitialized tracker."""

    def test_09_get_progress_before_start(self):
        """get_progress before start returns zero state."""
        tracker = ProgressTracker()
        progress = tracker.get_progress()
        assert progress["progress"] == 0
        assert progress["current_stage"] == ""
        assert progress["eta_seconds"] is None

    def test_10_no_stages_defined(self):
        """Tracker with no stages defined."""
        tracker = ProgressTracker()
        tracker.start()  # No stages — should not crash
        progress = tracker.get_progress()
        assert progress["progress"] == 0


class TestGlobalTrackerRegistry:
    """Global create/get/remove tracker functions."""

    def test_11_create_and_get(self):
        """Create a tracker and retrieve it by task_id."""
        tracker = create_tracker("test_doi_001")
        retrieved = get_tracker("test_doi_001")
        assert retrieved is tracker

    def test_12_get_nonexistent(self):
        """Get a non-existent tracker returns None."""
        assert get_tracker("nonexistent") is None

    def test_13_remove_tracker(self):
        """Remove a tracker — subsequent get returns None."""
        create_tracker("test_doi_002")
        remove_tracker("test_doi_002")
        assert get_tracker("test_doi_002") is None

    def test_14_remove_nonexistent(self):
        """Remove a non-existent tracker does not crash."""
        remove_tracker("nonexistent")  # should not raise
