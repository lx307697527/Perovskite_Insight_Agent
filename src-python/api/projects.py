"""Project management API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional
import uuid

from core.database import SessionLocal, Project, Literature

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None
    domain: str = "perovskite"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Project name cannot be empty")
        return v.strip()


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    domain: Optional[str] = None


class AssignLiteratureRequest(BaseModel):
    dois: list[str]


@router.get("")
async def list_projects():
    """List all projects with literature counts."""
    db = SessionLocal()
    try:
        projects = db.query(Project).order_by(Project.updated_at.desc()).all()
        result = []
        for p in projects:
            lit_count = db.query(Literature).filter(Literature.project_id == p.id).count()
            extracted_count = db.query(Literature).filter(
                Literature.project_id == p.id,
                Literature.is_extracted == True,
            ).count()
            result.append({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "domain": p.domain,
                "literature_count": lit_count,
                "extracted_count": extracted_count,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            })
        return {"success": True, "data": result}
    finally:
        db.close()


@router.post("")
async def create_project(body: CreateProjectRequest):
    """Create a new project."""
    project_id = uuid.uuid4().hex[:12]
    db = SessionLocal()
    try:
        project = Project(
            id=project_id,
            name=body.name,
            description=body.description,
            domain=body.domain,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return {
            "success": True,
            "data": {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "domain": project.domain,
                "created_at": project.created_at.isoformat() if project.created_at else None,
            },
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get project details with literature list."""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        literature = (
            db.query(Literature)
            .filter(Literature.project_id == project_id)
            .order_by(Literature.updated_at.desc())
            .all()
        )

        lit_list = []
        for lit in literature:
            lit_list.append({
                "doi": lit.doi,
                "title": lit.title,
                "journal": lit.journal,
                "year": lit.year,
                "authors": lit.authors,
                "is_extracted": lit.is_extracted,
                "extraction_stage": lit.extraction_stage,
                "quality_flag": lit.quality_flag,
            })

        return {
            "success": True,
            "data": {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "domain": project.domain,
                "literature": lit_list,
                "literature_count": len(lit_list),
                "created_at": project.created_at.isoformat() if project.created_at else None,
                "updated_at": project.updated_at.isoformat() if project.updated_at else None,
            },
        }
    finally:
        db.close()


@router.put("/{project_id}")
async def update_project(project_id: str, body: UpdateProjectRequest):
    """Update project."""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if body.name is not None:
            project.name = body.name
        if body.description is not None:
            project.description = body.description
        if body.domain is not None:
            project.domain = body.domain

        db.commit()
        db.refresh(project)
        return {
            "success": True,
            "data": {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "domain": project.domain,
            },
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    """Delete project. Literature in this project moves to inbox (project_id=NULL)."""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Move literature to inbox instead of cascade-deleting
        db.query(Literature).filter(Literature.project_id == project_id).update(
            {"project_id": None}
        )

        db.delete(project)
        db.commit()
        return {"success": True, "data": {"message": "Project deleted, literature moved to inbox"}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/{project_id}/literature")
async def add_literature_to_project(project_id: str, body: AssignLiteratureRequest):
    """Assign literature to a project."""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        updated = 0
        for doi in body.dois:
            lit = db.query(Literature).filter(Literature.doi == doi).first()
            if lit:
                lit.project_id = project_id
                updated += 1

        db.commit()
        return {
            "success": True,
            "data": {"message": f"Assigned {updated} literature to project", "updated_count": updated},
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
