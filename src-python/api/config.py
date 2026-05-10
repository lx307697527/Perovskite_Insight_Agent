"""Configuration & onboarding API routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/status")
async def get_config_status():
    """Check whether onboarding is needed."""
    # TODO: Phase 1 — check if AI engine is configured
    return {"success": True, "data": {"needs_onboarding": True}}


@router.post("/ai-engine")
async def save_ai_engine(config: dict):
    """Save AI model configuration with connectivity test."""
    # TODO: Phase 1 — validate API key, save encrypted
    return {"success": True, "data": {"message": "AI engine configured"}}


@router.post("/proxy")
async def save_proxy(config: dict):
    """Save proxy configuration."""
    # TODO: Phase 1
    return {"success": True, "data": {"message": "Proxy configured"}}


@router.put("/domains")
async def update_domains(config: dict):
    """Update domain selection."""
    # TODO: Phase 1
    return {"success": True, "data": {"message": "Domains updated"}}


@router.post("/embedding/verify")
async def verify_embedding():
    """Verify embedding model integrity."""
    # TODO: Phase 1 — check BGE model
    return {"success": True, "data": {"status": "not_installed"}}


@router.get("/cache")
async def get_cache_stats():
    """Get cache statistics."""
    # TODO: Phase 1
    return {"success": True, "data": {"total_papers": 0, "cache_size_mb": 0}}


@router.delete("/cache")
async def clear_cache():
    """Clear all cached data."""
    # TODO: Phase 1
    return {"success": True, "data": {"message": "Cache cleared"}}
