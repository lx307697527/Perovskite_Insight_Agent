"""
Stage-based progress engine for SIA V2.1.

Tracks multi-stage extraction/processing with estimated remaining time.
Each stage has: name, weight, start_time, end_time.
"""

import time
import threading
import datetime
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Stage:
    name: str
    weight: float  # relative time weight (0-1, sum = 1.0)
    label: str  # user-facing label
    start_time: Optional[float] = None
    end_time: Optional[float] = None

    @property
    def elapsed(self) -> float:
        if self.start_time is None:
            return 0.0
        end = self.end_time or time.time()
        return end - self.start_time


class ProgressTracker:
    """Thread-safe stage-based progress tracker."""

    def __init__(self):
        self._lock = threading.Lock()
        self._stages: list[Stage] = []
        self._current_index = -1
        self._start_time: Optional[float] = None
        self._cancelled = False

    def define_stages(self, stages: list[tuple[str, float, str]]):
        """Define the processing stages.
        Args: list of (name, weight, label) tuples. Weights should sum to 1.0.
        """
        with self._lock:
            self._stages = [Stage(name=n, weight=w, label=l) for n, w, l in stages]
            self._current_index = -1
            self._start_time = None
            self._cancelled = False

    def start(self):
        """Start the progress tracker."""
        with self._lock:
            self._start_time = time.time()
            self._current_index = 0
            if self._stages:
                self._stages[0].start_time = time.time()

    def advance(self, stage_name: Optional[str] = None):
        """Move to the next stage. Optionally specify the stage name to jump to."""
        with self._lock:
            if self._cancelled:
                return
            # End current stage
            if 0 <= self._current_index < len(self._stages):
                self._stages[self._current_index].end_time = time.time()
            # Find next stage
            if stage_name:
                for i, s in enumerate(self._stages):
                    if s.name == stage_name:
                        self._current_index = i
                        s.start_time = time.time()
                        return
            else:
                self._current_index += 1
                if self._current_index < len(self._stages):
                    self._stages[self._current_index].start_time = time.time()

    def cancel(self):
        """Cancel the progress tracker."""
        with self._lock:
            self._cancelled = True
            if 0 <= self._current_index < len(self._stages):
                self._stages[self._current_index].end_time = time.time()

    @property
    def is_cancelled(self) -> bool:
        with self._lock:
            return self._cancelled

    def get_progress(self) -> dict:
        """Get current progress state as a dict for SSE events."""
        with self._lock:
            if not self._stages or self._start_time is None:
                return {
                    "progress": 0,
                    "current_stage": "",
                    "current_label": "",
                    "stages": [],
                    "eta_seconds": None,
                    "timestamp": datetime.datetime.now().isoformat(),
                }

            total_elapsed = time.time() - self._start_time
            completed_weight = 0.0
            stages_info = []

            for i, stage in enumerate(self._stages):
                is_current = (i == self._current_index)
                is_completed = stage.end_time is not None

                if is_completed:
                    completed_weight += stage.weight
                elif is_current:
                    # Estimate partial progress within current stage
                    if stage.start_time and total_elapsed > 0:
                        # Use elapsed time ratio if we have prior stages to calibrate
                        prior_stages_time = sum(
                            s.elapsed for s in self._stages[:i] if s.end_time is not None
                        )
                        current_elapsed = time.time() - stage.start_time
                        if prior_stages_time > 0 and i > 0:
                            avg_speed = prior_stages_time / sum(
                                s.weight for s in self._stages[:i] if s.end_time is not None
                            )
                            expected_time = stage.weight * avg_speed
                            if expected_time > 0:
                                partial = min(current_elapsed / expected_time, 0.9)
                                completed_weight += stage.weight * partial
                        else:
                            # No calibration data, assume linear
                            completed_weight += stage.weight * 0.5

                stages_info.append({
                    "name": stage.name,
                    "label": stage.label,
                    "weight": stage.weight,
                    "status": "completed" if is_completed else ("active" if is_current else "pending"),
                })

            progress_pct = min(int(completed_weight * 100), 99)

            # ETA calculation
            eta_seconds = None
            if completed_weight > 0.05 and total_elapsed > 0:
                estimated_total = total_elapsed / completed_weight
                eta_seconds = max(0, int(estimated_total - total_elapsed))

            current_stage = ""
            current_label = ""
            if 0 <= self._current_index < len(self._stages):
                current_stage = self._stages[self._current_index].name
                current_label = self._stages[self._current_index].label

            return {
                "progress": progress_pct,
                "current_stage": current_stage,
                "current_label": current_label,
                "stages": stages_info,
                "eta_seconds": eta_seconds,
                "timestamp": datetime.datetime.now().isoformat(),
            }

    def get_completed_event(self) -> dict:
        """Get a completion event."""
        stages_info = []
        for stage in self._stages:
            stage.end_time = stage.end_time or time.time()
            stages_info.append({
                "name": stage.name,
                "label": stage.label,
                "weight": stage.weight,
                "status": "completed",
            })
        return {
            "progress": 100,
            "current_stage": "",
            "current_label": "",
            "stages": stages_info,
            "eta_seconds": 0,
            "timestamp": datetime.datetime.now().isoformat(),
        }


# Global tracker registry (keyed by DOI or task ID)
_active_trackers: dict[str, ProgressTracker] = {}
_trackers_lock = threading.Lock()


def create_tracker(task_id: str) -> ProgressTracker:
    """Create and register a new progress tracker."""
    tracker = ProgressTracker()
    with _trackers_lock:
        _active_trackers[task_id] = tracker
    return tracker


def get_tracker(task_id: str) -> Optional[ProgressTracker]:
    """Get an existing tracker."""
    with _trackers_lock:
        return _active_trackers.get(task_id)


def remove_tracker(task_id: str):
    """Remove a completed tracker."""
    with _trackers_lock:
        _active_trackers.pop(task_id, None)
