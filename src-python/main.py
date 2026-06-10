"""
SIA (Sci-Insight Agent) API — FastAPI entry point.
Slim orchestrator: app bootstrap, middleware, router mounting.
V1 routes have been migrated to api/ sub-modules.
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
import logging
import os

# Structured logging — all modules use logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)

# Internal imports
from core.database import init_db, migrate_v1_data
from core.security import decrypt_settings, needs_migration, migrate_from_plaintext
from core.model_manager import start_background_load

# ============================================================
# App bootstrap
# ============================================================
app = FastAPI(title="Sci-Insight Agent API")

init_db()

# One-time V1 → V2 data migration
migrate_v1_data()

# Migrate plaintext config to encrypted settings
if needs_migration():
    migrate_from_plaintext()

# Load config (prefer encrypted, fallback to legacy config.json)
current_config = decrypt_settings()
if not current_config:
    _LEGACY_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    if os.path.exists(_LEGACY_CONFIG):
        with open(_LEGACY_CONFIG, "r") as f:
            current_config = json.load(f)
    else:
        current_config = {
            "apiKey": "",
            "baseUrl": "https://api.deepseek.com",
            "model": "deepseek-chat"
        }

# Propagate config to engines
from core.extractor import extractor
from core.translator import translator
from core.stage1 import stage1_screener

extractor.update_config(current_config)
translator.update_config(current_config)
stage1_screener.update_config(current_config)

# Start embedding model background loading
start_background_load()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Mount API sub-modules
# ============================================================
from api.config import router as config_router
from api.search import router as search_router
from api.projects import router as projects_router
from api.literature import router as literature_router
from api.extract import router as extract_router
from api.qa import router as qa_router
from api.chat import router as chat_router
from api.compare import router as compare_router

app.include_router(config_router)
app.include_router(search_router)
app.include_router(projects_router)
app.include_router(literature_router)
app.include_router(extract_router)
app.include_router(qa_router)
app.include_router(chat_router)
app.include_router(compare_router)


# ============================================================
# Health check
# ============================================================
@app.get("/")
async def root():
    return {"status": "ok", "message": "SIA Backend Sidecar is running"}


# ============================================================
# V1 route proxies — thin wrappers for backward compatibility
# These delegate to the migrated api/ module implementations.
# ============================================================

@app.post("/api/settings")
async def v1_settings_proxy(config: dict):
    """V1 compat proxy → POST /api/config/settings"""
    from api.config import v1_update_settings, LegacyConfig
    return await v1_update_settings(LegacyConfig(**config))


@app.get("/api/extract/{doi:path}")
async def v1_extract_proxy(doi: str):
    """V1 compat proxy — SSE extraction via GET (legacy EventSource pattern)."""
    from api.extract import v1_start_extraction
    return await v1_start_extraction(doi)


if __name__ == "__main__":
    port = int(os.environ.get("SIA_PORT", os.environ.get("PIA_PORT", 8000)))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
