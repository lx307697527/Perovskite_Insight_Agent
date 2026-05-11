"""
Upload Manager — encapsulates V1 in-memory upload state.

Thread-safe management of PDF upload tracking, status, and results.
Replaces the global dicts previously in main.py.
"""

import threading
import logging
from typing import Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class UploadManager:
    """Thread-safe manager for PDF upload and extraction state."""

    def __init__(self):
        self._status: dict[str, dict] = {}
        self._lock: dict[str, bool] = {}
        self._results: dict[str, dict] = {}
        self._files: dict[str, str] = {}
        self._mutex = threading.Lock()

    def register_upload(self, upload_id: str, file_path: str, filename: str) -> None:
        """Register a new upload."""
        with self._mutex:
            self._status[upload_id] = {
                "status": "uploaded",
                "file_path": str(file_path),
                "filename": filename,
            }
            self._lock[upload_id] = False
            self._files[upload_id] = str(file_path)

    def get_status(self, upload_id: str) -> Optional[dict]:
        """Get upload status."""
        with self._mutex:
            return self._status.get(upload_id)

    def is_locked(self, upload_id: str) -> bool:
        """Check if upload is being processed."""
        with self._mutex:
            return self._lock.get(upload_id, False)

    def set_locked(self, upload_id: str, locked: bool) -> None:
        """Set lock state for an upload."""
        with self._mutex:
            self._lock[upload_id] = locked

    def get_file_path(self, upload_id: str) -> Optional[str]:
        """Get the file path for an upload."""
        with self._mutex:
            return self._files.get(upload_id)

    def update_completed(self, upload_id: str, result: dict) -> None:
        """Mark upload as completed with results."""
        with self._mutex:
            self._status[upload_id]["status"] = "completed"
            self._status[upload_id]["result"] = result
            self._results[upload_id] = result

    def get_result(self, upload_id: str) -> Optional[dict]:
        """Get extraction result for a completed upload."""
        with self._mutex:
            if upload_id in self._results:
                return self._results[upload_id]
            status = self._status.get(upload_id, {})
            if status.get("status") == "completed":
                return status.get("result", {})
            return None

    def has_upload(self, upload_id: str) -> bool:
        """Check if upload_id exists."""
        with self._mutex:
            return upload_id in self._status

    def cleanup(self, upload_id: str) -> None:
        """Clean up upload state after processing."""
        with self._mutex:
            self._status.pop(upload_id, None)
            self._lock.pop(upload_id, None)


# Global singleton
upload_manager = UploadManager()
