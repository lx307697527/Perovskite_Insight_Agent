"""
Integration tests for api/config.py

Covers: config status, AI engine config, proxy, domains, embedding verify, cache.
Test cases: CFG-01 ~ CFG-16
"""

import json
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestConfigStatus:
    """CFG-01, CFG-02: GET /api/config/status."""

    def test_01_no_config_needs_onboarding(self, client):
        """CFG-01: No config → needs_onboarding: true."""
        resp = client.get("/api/config/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["needs_onboarding"] is True

    def test_02_with_config_no_onboarding(self, client, _write_encrypted_config):
        """CFG-02: Config exists → needs_onboarding: false."""
        resp = client.get("/api/config/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["needs_onboarding"] is False
        assert data["data"]["ai_configured"] is True
        assert "cache_size_mb" in data["data"]
        assert "total_papers" in data["data"]


class TestAIEngineConfig:
    """CFG-03 ~ CFG-07: POST /api/config/ai-engine."""

    def test_03_valid_config_saves(self, client, mock_httpx_client):
        """CFG-03: Valid config + successful connectivity test."""
        mock_httpx_client.get.return_value.status_code = 200
        mock_httpx_client.get.return_value.json.return_value = {"data": []}

        resp = client.post("/api/config/ai-engine", json={
            "apiKey": "sk-test-key",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o",
            "stage1Model": "gpt-4o-mini",
            "stage2Model": "gpt-4o",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    def test_04_invalid_api_key_401(self, client, mock_httpx_client):
        """CFG-04: API Key returns 401."""
        mock_httpx_client.get.return_value.status_code = 401

        resp = client.post("/api/config/ai-engine", json={
            "apiKey": "sk-bad-key",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o",
        })
        assert resp.status_code == 400
        assert "验证失败" in resp.json()["detail"]

    def test_05_connect_error(self, client, mock_httpx_client):
        """CFG-05: Connection error to Base URL."""
        import httpx
        mock_httpx_client.get.side_effect = httpx.ConnectError("Connection refused")

        resp = client.post("/api/config/ai-engine", json={
            "apiKey": "sk-test",
            "baseUrl": "https://bad-host.example.com/v1",
            "model": "gpt-4o",
        })
        assert resp.status_code == 400
        assert "无法连接" in resp.json()["detail"]

    def test_06_timeout(self, client, mock_httpx_client):
        """CFG-06: Connection timeout."""
        import httpx
        mock_httpx_client.get.side_effect = httpx.TimeoutException("Timeout")

        resp = client.post("/api/config/ai-engine", json={
            "apiKey": "sk-test",
            "baseUrl": "https://slow.example.com/v1",
            "model": "gpt-4o",
        })
        assert resp.status_code == 408
        assert "超时" in resp.json()["detail"]

    def test_07_empty_api_key_rejected(self, client):
        """CFG-07: Empty API Key → 422 validation error."""
        resp = client.post("/api/config/ai-engine", json={
            "apiKey": "",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o",
        })
        assert resp.status_code == 422


class TestConnectivityTest:
    """CFG-08: POST /api/config/test-connectivity."""

    def test_08_connected_success(self, client, mock_httpx_client):
        """CFG-08: Connectivity test succeeds."""
        mock_httpx_client.get.return_value.status_code = 200

        resp = client.post("/api/config/test-connectivity", json={
            "apiKey": "sk-test",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_08b_connect_error(self, client, mock_httpx_client):
        """Connectivity test fails on connection error."""
        import httpx
        mock_httpx_client.get.side_effect = httpx.ConnectError("refused")

        resp = client.post("/api/config/test-connectivity", json={
            "apiKey": "sk-test",
            "baseUrl": "https://bad.example.com/v1",
            "model": "gpt-4o",
        })
        assert resp.status_code == 400


class TestProxyConfig:
    """CFG-09, CFG-10: POST /api/config/proxy."""

    def test_09_save_proxy_url(self, client):
        """CFG-09: Save proxy URL."""
        resp = client.post("/api/config/proxy", json={
            "proxyUrl": "http://proxy.example.com:8080",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_10_save_cookie_header(self, client):
        """CFG-10: Save cookie header."""
        resp = client.post("/api/config/proxy", json={
            "cookieHeader": "SESSION=abc123;",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True


class TestDomainConfig:
    """CFG-11, CFG-12: PUT /api/config/domains."""

    def test_11_valid_domain(self, client):
        """CFG-11: Valid domain accepted."""
        for domain in ("perovskite", "semiconductor", "custom"):
            resp = client.put("/api/config/domains", json={"domain": domain})
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_12_invalid_domain(self, client):
        """CFG-12: Invalid domain rejected."""
        resp = client.put("/api/config/domains", json={"domain": "invalid_domain"})
        assert resp.status_code == 400


class TestEmbeddingVerify:
    """CFG-13, CFG-14: POST /api/config/embedding/verify."""

    def test_13_model_not_installed(self, client, tmp_path):
        """CFG-13: Model directory doesn't exist."""
        resp = client.post("/api/config/embedding/verify")
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "not_installed"

    def test_14_model_incomplete(self, client, tmp_path):
        """CFG-14: Model directory exists but no .ready marker."""
        model_dir = tmp_path / "SIA" / "embedding_model"
        model_dir.mkdir(parents=True)
        # No .ready file

        resp = client.post("/api/config/embedding/verify")
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "incomplete"


class TestCacheManagement:
    """CFG-15, CFG-16: Cache stats and cleanup."""

    def test_15_cache_stats(self, client, seeded_literature):
        """CFG-15: Get cache statistics."""
        resp = client.get("/api/config/cache")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "total_papers" in data
        assert "extracted_count" in data
        assert "cache_size_mb" in data

    def test_16_clear_cache(self, client):
        """CFG-16: Clear downloaded PDF cache."""
        resp = client.delete("/api/config/cache")
        assert resp.status_code == 200
        assert resp.json()["success"] is True


# ============================================================
# Helper fixture: write encrypted config
# ============================================================

@pytest.fixture
def _write_encrypted_config(_temp_sia_dir):
    """Pre-write an encrypted config so status shows configured."""
    from core.security import encrypt_settings
    encrypt_settings({
        "apiKey": "sk-test-key",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o",
        "domain": "perovskite",
    })
    yield
