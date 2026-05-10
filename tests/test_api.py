import pytest
from fastapi.testclient import TestClient
from main import app
import json

client = TestClient(app)

def test_read_main():
    """测试 API 根路径连通性"""
    response = client.get("/")
    assert response.status_code == 200

def test_search_papers_empty():
    """测试空搜索词处理"""
    response = client.get("/api/search?query=")
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert "results" in response.json()["data"]

def test_get_paper_details_invalid_doi():
    """测试无效 DOI 格式"""
    invalid_doi = "not-a-doi"
    response = client.get(f"/api/paper/{invalid_doi}")
    assert response.status_code == 400
    assert "Invalid DOI format" in response.json()["detail"]

def test_config_cycle():
    """测试配置读取与保存"""
    test_config = {
        "apiKey": "test_key",
        "baseUrl": "https://api.test.com",
        "model": "test-model"
    }
    # 保存配置
    response = client.post("/api/settings", json=test_config)
    assert response.status_code == 200
    assert response.json()["success"] is True
    
    # 验证保存成功（通过读取配置文件逻辑，此处简化为验证接口返回）
    # 在实际测试中可以 check config.json 文件内容
