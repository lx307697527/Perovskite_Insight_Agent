"""Literature and inbox API routes."""

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
import uuid
import json
import re
import os
from pathlib import Path

from core.database import SessionLocal, Literature, SIFile, Project
from core.crawler import crawler

router = APIRouter(prefix="/api", tags=["literature"])

DOI_PATTERN = re.compile(r'^10\.\d{4,9}/[-._;()/:A-Z0-9]+$', re.IGNORECASE)


class AddLiteratureRequest(BaseModel):
    input: str  # DOI, keyword, or PDF path
    project_id: Optional[str] = None


class MoveToProjectRequest(BaseModel):
    project_id: str


def _detect_input_type(user_input: str) -> str:
    """Auto-detect whether input is a DOI, local file path, or search keyword."""
    stripped = user_input.strip()
    if DOI_PATTERN.match(stripped):
        return "doi"
    # Check if it looks like a file path
    if stripped.endswith(".pdf") and (os.path.exists(stripped) or re.match(r'^[A-Za-z]:\\', stripped)):
        return "pdf"
    return "keyword"


@router.post("/literature/add")
async def add_literature(body: AddLiteratureRequest):
    """Unified add: auto-detect DOI / PDF upload / keyword search."""
    input_type = _detect_input_type(body.input)

    if input_type == "doi":
        return await _add_by_doi(body.input, body.project_id)
    elif input_type == "pdf":
        return await _add_by_local_pdf(body.input, body.project_id)
    else:
        return await _add_by_keyword(body.input, body.project_id)


async def _add_by_doi(doi: str, project_id: Optional[str] = None) -> dict:
    """Add literature by DOI: download + fetch metadata."""
    db = SessionLocal()
    try:
        # Check cache first
        existing = db.query(Literature).filter(Literature.doi == doi).first()
        if existing:
            return {"success": True, "data": {"doi": doi, "type": "doi", "cached": True}}

        # Fetch metadata from Semantic Scholar
        meta = await crawler.get_paper_by_doi(doi)

        lit = Literature(
            doi=doi,
            project_id=project_id,
            title=meta.get("title", f"Paper {doi}") if meta else f"Paper {doi}",
            journal=meta.get("journal") if meta else None,
            year=meta.get("year") if meta else None,
            authors=meta.get("authors") if meta else None,
            abstract=meta.get("abstract") if meta else None,
            extraction_stage="none",
        )
        db.add(lit)
        db.commit()
        return {"success": True, "data": {"doi": doi, "type": "doi", "cached": False}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add DOI: {str(e)}")
    finally:
        db.close()


async def _add_by_local_pdf(file_path: str, project_id: Optional[str] = None) -> dict:
    """Add literature by local PDF path."""
    resolved = Path(file_path).resolve()
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="PDF file not found")

    pseudo_doi = f"local_{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        lit = Literature(
            doi=pseudo_doi,
            project_id=project_id,
            title=resolved.stem,
            local_pdf_path=str(resolved),
            extraction_stage="none",
        )
        db.add(lit)
        db.commit()
        return {"success": True, "data": {"doi": pseudo_doi, "type": "pdf", "filename": resolved.name}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


async def _add_by_keyword(keyword: str, project_id: Optional[str] = None) -> dict:
    """Add literature by keyword search — returns search results for user to pick."""
    results = await crawler.search_papers_dual_engine(keyword)
    return {
        "success": True,
        "data": {
            "type": "keyword",
            "results": results,
            "project_id": project_id,
        },
    }


@router.post("/literature/upload")
async def upload_literature(file: UploadFile = File(...), project_id: Optional[str] = None):
    """Upload a PDF file."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    upload_id = f"upload_{uuid.uuid4().hex[:8]}"
    upload_dir = Path(os.getenv("TEMP", "/tmp")) / "sia_uploads"
    upload_dir.mkdir(exist_ok=True)

    file_path = upload_dir / f"{upload_id}.pdf"
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    db = SessionLocal()
    try:
        lit = Literature(
            doi=upload_id,
            project_id=project_id,
            title=file.filename,
            local_pdf_path=str(file_path),
            extraction_stage="none",
        )
        db.add(lit)
        db.commit()
        return {"success": True, "data": {"doi": upload_id, "filename": file.filename}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/literature/doi")
async def resolve_doi(body: dict):
    """Resolve DOI: download PDF + fetch metadata."""
    doi = body.get("doi", "").strip()
    project_id = body.get("project_id")

    if not DOI_PATTERN.match(doi):
        raise HTTPException(status_code=400, detail="Invalid DOI format")

    return await _add_by_doi(doi, project_id)


@router.delete("/literature/{doi:path}")
async def delete_literature(doi: str):
    """Delete a literature entry."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            raise HTTPException(status_code=404, detail="Literature not found")
        db.delete(lit)
        db.commit()
        return {"success": True, "data": {"message": "Deleted"}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.get("/literature/{doi:path}")
async def get_literature(doi: str):
    """Get literature details including extraction results."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            raise HTTPException(status_code=404, detail="Literature not found")

        si_files = (
            db.query(SIFile).filter(SIFile.literature_doi == doi).all()
        )

        result = {
            "doi": lit.doi,
            "project_id": lit.project_id,
            "title": lit.title,
            "journal": lit.journal,
            "year": lit.year,
            "authors": lit.authors,
            "abstract": lit.abstract,
            "is_extracted": lit.is_extracted,
            "extraction_stage": lit.extraction_stage,
            "data_source": lit.data_source,
            "relevance_score": lit.relevance_score,
            "quality_flag": lit.quality_flag,
            "local_pdf_path": lit.local_pdf_path,
            "performance_data": json.loads(lit.performance_data) if lit.performance_data else None,
            "process_params": json.loads(lit.process_params) if lit.process_params else None,
            "stability_data": json.loads(lit.stability_data) if lit.stability_data else None,
            "source_mapping": json.loads(lit.source_mapping) if lit.source_mapping else None,
            "si_files": [
                {"id": sf.id, "type": sf.type, "status": sf.status, "local_path": sf.local_path}
                for sf in si_files
            ],
            "created_at": lit.created_at.isoformat() if lit.created_at else None,
            "updated_at": lit.updated_at.isoformat() if lit.updated_at else None,
        }
        return {"success": True, "data": result}
    finally:
        db.close()


@router.get("/inbox")
async def list_inbox():
    """List literature in the temporary inbox (project_id=NULL)."""
    db = SessionLocal()
    try:
        inbox_items = (
            db.query(Literature)
            .filter(Literature.project_id == None)
            .order_by(Literature.updated_at.desc())
            .all()
        )
        result = []
        for lit in inbox_items:
            result.append({
                "doi": lit.doi,
                "title": lit.title,
                "journal": lit.journal,
                "year": lit.year,
                "authors": lit.authors,
                "is_extracted": lit.is_extracted,
                "extraction_stage": lit.extraction_stage,
                "quality_flag": lit.quality_flag,
            })
        return {"success": True, "data": result}
    finally:
        db.close()


@router.post("/inbox/{doi:path}/move")
async def move_from_inbox(doi: str, body: MoveToProjectRequest):
    """Move literature from inbox to a project."""
    db = SessionLocal()
    try:
        lit = db.query(Literature).filter(Literature.doi == doi).first()
        if not lit:
            raise HTTPException(status_code=404, detail="Literature not found")

        project = db.query(Project).filter(Project.id == body.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        lit.project_id = body.project_id
        db.commit()
        return {"success": True, "data": {"message": "Moved", "project_id": body.project_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
