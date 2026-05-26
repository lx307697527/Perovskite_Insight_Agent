"""Configuration & onboarding API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional
import os

from core.security import encrypt_settings, decrypt_settings
from core.database import SessionLocal, Literature, Project

router = APIRouter(prefix="/api/config", tags=["config"])


# --- Request Models ---

class AIEngineConfig(BaseModel):
    apiKey: str
    baseUrl: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    stage1Model: Optional[str] = None
    stage2Model: Optional[str] = None

    @field_validator("apiKey")
    @classmethod
    def api_key_not_empty(cls, v: str) -> str:
        if not v or v.strip() == "":
            raise ValueError("API Key cannot be empty")
        return v.strip()


class ProxyConfig(BaseModel):
    proxyUrl: Optional[str] = None
    cookieHeader: Optional[str] = None


class DomainConfig(BaseModel):
    domain: str = "perovskite"  # perovskite / semiconductor / custom


# --- Endpoints ---

@router.get("/status")
async def get_config_status():
    """Check whether onboarding is needed."""
    settings = decrypt_settings()
    ai_configured = bool(settings.get("apiKey"))
    needs_onboarding = not ai_configured

    # Check embedding status
    embedding_status = "not_installed"
    sia_dir = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
    )
    model_marker = os.path.join(sia_dir, "embedding_model", ".ready")
    loading_marker = os.path.join(sia_dir, "embedding_model", ".loading")
    if os.path.exists(model_marker):
        embedding_status = "ready"
    elif os.path.exists(loading_marker):
        embedding_status = "loading"

    # Cache stats
    db = SessionLocal()
    try:
        total_papers = db.query(Literature).count()
        total_projects = db.query(Project).count()
    finally:
        db.close()

    cache_size_mb = 0.0
    downloads_dir = os.path.join(sia_dir, "downloads")
    if os.path.exists(downloads_dir):
        total_bytes = sum(
            os.path.getsize(os.path.join(dirpath, filename))
            for dirpath, _, filenames in os.walk(downloads_dir)
            for filename in filenames
        )
        cache_size_mb = round(total_bytes / (1024 * 1024), 1)

    return {
        "success": True,
        "data": {
            "needs_onboarding": needs_onboarding,
            "ai_configured": ai_configured,
            "embedding_status": embedding_status,
            "domain": settings.get("domain", "perovskite"),
            "total_papers": total_papers,
            "total_projects": total_projects,
            "cache_size_mb": cache_size_mb,
        },
    }


@router.post("/ai-engine")
async def save_ai_engine(config: AIEngineConfig):
    """Save AI model configuration with connectivity test."""
    import httpx

    settings = decrypt_settings()

    # Connectivity test
    test_url = config.baseUrl.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {config.apiKey}"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(test_url, headers=headers)
            if resp.status_code == 401:
                raise HTTPException(
                    status_code=400,
                    detail="API Key 验证失败，请检查 Key 是否正确",
                )
            # Some providers return 200 with empty list even for valid keys
    except httpx.ConnectError:
        raise HTTPException(
            status_code=400,
            detail=f"无法连接到 {config.baseUrl}，请检查 Base URL",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=408,
            detail=f"连接 {config.baseUrl} 超时，请检查网络或代理设置",
        )
    except HTTPException:
        raise
    except Exception as e:
        # Non-fatal: config saved even if test fails (e.g. non-standard API)
        pass

    # Save config
    settings.update(config.model_dump())
    encrypt_settings(settings)

    # Update runtime config
    from main import extractor, translator
    extractor.update_config(settings)
    translator.update_config(settings)

    return {"success": True, "data": {"message": "AI engine configured"}}


@router.post("/test-connectivity")
async def test_connectivity(config: AIEngineConfig):
    """Test AI model connectivity through backend proxy."""
    import httpx

    test_url = config.baseUrl.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {config.apiKey}"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(test_url, headers=headers)
            if resp.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="API Key 验证失败，请检查 Key 是否正确",
                )
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"连接失败: {resp.reason_phrase} ({resp.status_code})",
                )
            return {"success": True, "data": {"message": "Connected successfully"}}
    except httpx.ConnectError:
        raise HTTPException(
            status_code=400,
            detail=f"无法连接到 {config.baseUrl}，请检查 Base URL",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=408,
            detail=f"连接 {config.baseUrl} 超时，请检查网络或代理设置",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"测试失败: {str(e)}",
        )


@router.post("/proxy")
async def save_proxy(config: ProxyConfig):
    """Save proxy configuration."""
    settings = decrypt_settings()
    if config.proxyUrl:
        settings["proxyUrl"] = config.proxyUrl
    if config.cookieHeader:
        settings["cookieHeader"] = config.cookieHeader
    encrypt_settings(settings)
    return {"success": True, "data": {"message": "Proxy configured"}}


@router.put("/domains")
async def update_domains(config: DomainConfig):
    """Update domain selection."""
    valid_domains = {"perovskite", "semiconductor", "custom"}
    if config.domain not in valid_domains:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid domain. Must be one of: {', '.join(valid_domains)}",
        )
    settings = decrypt_settings()
    settings["domain"] = config.domain
    encrypt_settings(settings)
    return {"success": True, "data": {"message": "Domains updated", "domain": config.domain}}


@router.post("/embedding/verify")
async def verify_embedding():
    """Verify embedding model integrity."""
    sia_dir = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
    )
    model_dir = os.path.join(sia_dir, "embedding_model")

    if not os.path.exists(model_dir):
        return {
            "success": True,
            "data": {"status": "not_installed", "message": "Embedding model not found"},
        }

    ready_marker = os.path.join(model_dir, ".ready")
    if os.path.exists(ready_marker):
        return {"success": True, "data": {"status": "ready"}}
    else:
        return {
            "success": True,
            "data": {"status": "incomplete", "message": "Model files incomplete"},
        }


@router.get("/cache")
async def get_cache_stats():
    """Get cache statistics."""
    sia_dir = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
    )

    db = SessionLocal()
    try:
        total_papers = db.query(Literature).count()
        extracted_count = db.query(Literature).filter(Literature.is_extracted == True).count()
    finally:
        db.close()

    cache_size_mb = 0.0
    downloads_dir = os.path.join(sia_dir, "downloads")
    if os.path.exists(downloads_dir):
        total_bytes = sum(
            os.path.getsize(os.path.join(dirpath, filename))
            for dirpath, _, filenames in os.walk(downloads_dir)
            for filename in filenames
        )
        cache_size_mb = round(total_bytes / (1024 * 1024), 1)

    return {
        "success": True,
        "data": {
            "total_papers": total_papers,
            "extracted_count": extracted_count,
            "cache_size_mb": cache_size_mb,
        },
    }


@router.delete("/cache")
async def clear_cache():
    """Clear downloaded PDF cache (keeps database records)."""
    import shutil

    sia_dir = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "SIA"
    )
    downloads_dir = os.path.join(sia_dir, "downloads")

    if os.path.exists(downloads_dir):
        shutil.rmtree(downloads_dir)
        os.makedirs(downloads_dir, exist_ok=True)

    return {"success": True, "data": {"message": "Cache cleared"}}


# ============================================================
# V1 backward-compat routes (migrated from main.py)
# ============================================================

class LegacyConfig(BaseModel):
    apiKey: str
    baseUrl: str
    model: str


@router.post("/settings")
async def v1_update_settings(config: LegacyConfig):
    """V1 compat: Update AI settings. Prefer POST /api/config/ai-engine for V2."""
    from core.security import encrypt_settings
    from core.extractor import extractor
    from core.translator import translator
    from core.stage1 import stage1_screener

    try:
        settings = decrypt_settings()
        settings.update(config.model_dump())
        encrypt_settings(settings)
        extractor.update_config(settings)
        translator.update_config(settings)
        stage1_screener.update_config(settings)

        # Update runtime config in main module
        import main
        main.current_config.update(settings)

        return {"success": True, "data": {"message": "Settings updated"}}
    except Exception as e:
        return {"success": False, "error": str(e)}
