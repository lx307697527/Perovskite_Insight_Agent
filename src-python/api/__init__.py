"""
API route modules for SIA V2.1
"""
from .config import router as config_router
from .search import router as search_router
from .projects import router as projects_router
from .literature import router as literature_router
from .extract import router as extract_router
from .qa import router as qa_router
from .chat import router as chat_router
from .compare import router as compare_router

__all__ = [
    "config_router",
    "search_router",
    "projects_router",
    "literature_router",
    "extract_router",
    "qa_router",
    "chat_router",
    "compare_router",
]
