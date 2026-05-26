"""
SIA Backend Test Fixtures

Provides:
- In-memory SQLite for integration tests
- Mocked LLM/external API clients
- Test database helpers
"""

import os
import sys
import json
import tempfile
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure src-python is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "src-python"))


# ============================================================
# Temporary directory for all file-based operations
# ============================================================

@pytest.fixture(autouse=True)
def _temp_sia_dir(tmp_path):
    """Redirect all SIA file paths to a temp directory."""
    sia_dir = str(tmp_path / "SIA")
    os.makedirs(sia_dir, exist_ok=True)
    with patch("core.security._SETTINGS_DIR", sia_dir):
        with patch("core.security._SETTINGS_FILE", os.path.join(sia_dir, "settings.enc")):
            with patch("core.database.get_db_path", return_value=os.path.join(sia_dir, "sia_database.db")):
                yield sia_dir


# ============================================================
# Database fixtures
# ============================================================

@pytest.fixture
def db_session(_temp_sia_dir):
    """Provide a clean database session for integration tests."""
    from core.database import SessionLocal, Base, init_db, engine

    init_db()
    session = SessionLocal()
    yield session

    # Rollback all changes (don't delete — engine is global)
    session.rollback()
    session.close()


@pytest.fixture
def seeded_project(db_session):
    """Create a test project and return its ID."""
    from core.database import Project

    project = Project(
        id="test_proj_001",
        name="Test Perovskite Study",
        domain="perovskite",
    )
    db_session.add(project)
    db_session.commit()
    return project.id


@pytest.fixture
def seeded_literature(db_session, seeded_project):
    """Create a test literature entry and return its DOI."""
    from core.database import Literature

    lit = Literature(
        doi="10.1126/science.abc1234",
        project_id=seeded_project,
        title="Efficiency exceeding 25% in perovskite solar cells",
        journal="Science",
        year=2026,
        authors="Kim J. et al.",
        extraction_stage="stage2",
        is_extracted=True,
        performance_data=json.dumps({
            "metrics": [
                {"field": "PCE", "value": 25.1, "scan_direction": "R-scan", "has_spo": False},
                {"field": "Voc", "value": 1.21},
                {"field": "Jsc", "value": 25.3},
                {"field": "FF", "value": 82.1},
            ]
        }),
        process_params=json.dumps({
            "annealing_temperature": "100°C",
            "annealing_time": "10 min",
        }),
        stability_data=json.dumps({
            "protocol": "ISOS-L1",
            "t80": ">1000",
        }),
    )
    db_session.add(lit)
    db_session.commit()
    return lit.doi


@pytest.fixture
def seeded_inbox_literature(db_session):
    """Create a test literature entry in inbox (project_id=NULL)."""
    from core.database import Literature

    lit = Literature(
        doi="10.1002/adma.20241234",
        project_id=None,
        title="High Mobility in ZnO Thin Films",
        journal="Adv. Mater.",
        year=2025,
        authors="Zhang et al.",
        extraction_stage="none",
    )
    db_session.add(lit)
    db_session.commit()
    return lit.doi


# ============================================================
# Mock external services
# ============================================================

@pytest.fixture
def mock_llm_client():
    """Mock OpenAI async client for LLM tests."""
    client = MagicMock()
    return client


@pytest.fixture
def mock_httpx_client():
    """Mock httpx.AsyncClient for connectivity tests."""
    with patch("httpx.AsyncClient") as mock:
        instance = MagicMock()
        mock.return_value.__aenter__.return_value = instance
        mock.return_value.__aexit__.return_value = None
        yield instance


@pytest.fixture
def mock_embedding_ready():
    """Mock embedding model status to 'ready'."""
    with patch("core.model_manager.get_status", return_value="ready"):
        yield


@pytest.fixture
def mock_embedding_loading():
    """Mock embedding model status to 'loading'."""
    with patch("core.model_manager.get_status", return_value="loading"):
        yield


@pytest.fixture
def mock_embedding_not_ready():
    """Mock embedding model status to 'not_installed'."""
    with patch("core.model_manager.get_status", return_value="not_installed"):
        yield


# ============================================================
# Mock search results
# ============================================================

@pytest.fixture
def mock_search_results():
    """Standard mock search results for dual-engine search."""
    return [
        {
            "doi": "10.1126/science.abc1234",
            "title": "Efficiency exceeding 25% in perovskite solar cells",
            "journal": "Science",
            "year": 2026,
            "authors": "Kim J. et al.",
            "relevance": 95,
            "cached": False,
        },
        {
            "doi": "10.1038/s41560-025-01234",
            "title": "Cs/FA/MA Triple Cation Stability",
            "journal": "Nat. Energy",
            "year": 2025,
            "authors": "Zhang et al.",
            "relevance": 88,
            "cached": False,
        },
    ]


# ============================================================
# Helper: collect SSE events from a generator
# ============================================================

def collect_sse_events(generator):
    """Collect all SSE data events from a generator into a list of dicts."""
    events = []
    for chunk in generator:
        text = chunk.strip()
        if text.startswith("data: "):
            payload = text[6:]
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                events.append({"_raw": payload})
    return events
