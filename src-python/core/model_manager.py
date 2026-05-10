"""
Embedding model manager for SIA V2.1.

Manages BGE-base-en-v1.5 model loading with background-async strategy:
1. App startup → wait 2s → begin loading in background thread
2. Loading period → /api/config/embedding returns status: "loading"
3. Load complete → status: "ready"
4. Loading period Q&A requests → 503 + hint
"""

import os
import threading
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_SIA_DIR = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
)
_MODEL_DIR = os.path.join(_SIA_DIR, "embedding_model")
_READY_MARKER = os.path.join(_MODEL_DIR, ".ready")
_LOADING_MARKER = os.path.join(_MODEL_DIR, ".loading")

# Singleton state
_model = None
_tokenizer = None
_status = "not_installed"  # not_installed | loading | ready | error
_status_lock = threading.Lock()
_load_thread: Optional[threading.Thread] = None


def get_status() -> str:
    """Get current embedding model status."""
    with _status_lock:
        return _status


def _set_status(status: str):
    global _status
    with _status_lock:
        _status = status


def _load_model():
    """Load the embedding model in a background thread."""
    global _model, _tokenizer

    _set_status("loading")
    os.makedirs(_MODEL_DIR, exist_ok=True)

    # Write loading marker
    with open(_LOADING_MARKER, "w") as f:
        f.write("loading")

    try:
        from sentence_transformers import SentenceTransformer

        model_name = "BAAI/bge-base-en-v1.5"

        # Check if model is cached locally
        if os.path.exists(_MODEL_DIR) and os.listdir(_MODEL_DIR):
            logger.info(f"Loading embedding model from cache: {_MODEL_DIR}")
            _model = SentenceTransformer(_MODEL_DIR)
        else:
            logger.info(f"Downloading embedding model: {model_name}")
            _model = SentenceTransformer(model_name)
            # Cache for future use
            _model.save(_MODEL_DIR)

        # Write ready marker
        with open(_READY_MARKER, "w") as f:
            f.write("ready")

        # Remove loading marker
        if os.path.exists(_LOADING_MARKER):
            os.remove(_LOADING_MARKER)

        _set_status("ready")
        logger.info("Embedding model loaded successfully")

    except ImportError:
        logger.warning("sentence-transformers not installed, embedding unavailable")
        _set_status("not_installed")
        if os.path.exists(_LOADING_MARKER):
            os.remove(_LOADING_MARKER)

    except Exception as e:
        logger.error(f"Failed to load embedding model: {e}")
        _set_status("error")
        if os.path.exists(_LOADING_MARKER):
            os.remove(_LOADING_MARKER)


def start_background_load():
    """Start loading the embedding model in a background thread (non-blocking)."""
    global _load_thread

    if _model is not None:
        return  # Already loaded

    # Check if already loading
    with _status_lock:
        if _status == "loading":
            return

    def _delayed_load():
        import time
        time.sleep(2)  # Wait 2s after app startup
        _load_model()

    _load_thread = threading.Thread(target=_delayed_load, daemon=True)
    _load_thread.start()


def get_model():
    """Get the loaded model, or None if not ready."""
    if _model is not None:
        return _model

    # Check if model files exist on disk (lazy load from cache)
    if os.path.exists(_READY_MARKER):
        _load_model()

    return _model


def embed_texts(texts: list[str]) -> Optional[list[list[float]]]:
    """Embed a list of texts. Returns None if model not ready."""
    model = get_model()
    if model is None:
        return None

    embeddings = model.encode(texts, normalize_embeddings=True)
    return embeddings.tolist()


def embed_single(text: str) -> Optional[list[float]]:
    """Embed a single text. Returns None if model not ready."""
    result = embed_texts([text])
    if result is None:
        return None
    return result[0]
