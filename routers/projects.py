"""
CMaps Projects Router — Save/load/export map states.
"""
import json
import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, Project, Country

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


def _snapshot_countries(db: Session) -> str:
    """Capture current state of all countries as GeoJSON."""
    countries = db.query(Country).all()
    features = [c.to_geojson_feature() for c in countries]
    collection = {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "saved_at": datetime.datetime.utcnow().isoformat(),
            "country_count": len(features),
        }
    }
    return json.dumps(collection)


@router.get("")
def list_projects(db: Session = Depends(get_db)):
    """List all saved projects."""
    projects = db.query(Project).order_by(Project.updated_at.desc()).all()
    return [{
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    } for p in projects]


@router.post("")
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    """Save the current map state as a new project."""
    snapshot = _snapshot_countries(db)
    project = Project(
        name=data.name,
        description=data.description,
        snapshot=snapshot,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at.isoformat() if project.created_at else None,
    }


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    """Get a saved project with its snapshot."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "snapshot": json.loads(project.snapshot),
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


@router.post("/{project_id}/load")
def load_project(project_id: int, db: Session = Depends(get_db)):
    """Load a saved project — replaces all current countries with the snapshot."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    snapshot = json.loads(project.snapshot)
    features = snapshot.get("features", [])

    # Clear existing countries
    db.query(Country).delete()
    db.flush()

    # Restore from snapshot
    for feature in features:
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})
        country = Country(
            name=props.get("name", "Unknown"),
            iso_code=props.get("iso_code"),
            geometry=json.dumps(geom),
            population=props.get("population", 0),
            area_km2=props.get("area_km2", 0),
            capital=props.get("capital"),
            flag_emoji=props.get("flag_emoji", "🏳️"),
            color=props.get("color"),
            continent=props.get("continent"),
            subregion=props.get("subregion"),
            sovereignty=props.get("sovereignty"),
            is_custom=props.get("is_custom", False),
        )
        db.add(country)

    db.commit()
    return {"status": "loaded", "country_count": len(features)}


@router.post("/{project_id}/save")
def save_project(project_id: int, db: Session = Depends(get_db)):
    """Overwrite a project's snapshot with the current map state."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project.snapshot = _snapshot_countries(db)
    project.updated_at = datetime.datetime.utcnow()
    db.commit()

    return {"status": "saved", "id": project.id}


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """Delete a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    db.delete(project)
    db.commit()
    return {"status": "deleted", "id": project_id}


@router.get("/{project_id}/export")
def export_project(project_id: int, db: Session = Depends(get_db)):
    """Export a project as a downloadable GeoJSON file."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    filename = f"{project.name.replace(' ', '_').lower()}.geojson"
    return Response(
        content=project.snapshot,
        media_type="application/geo+json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/current")
def export_current(db: Session = Depends(get_db)):
    """Export current map state as a downloadable GeoJSON file."""
    snapshot = _snapshot_countries(db)
    return Response(
        content=snapshot,
        media_type="application/geo+json",
        headers={"Content-Disposition": 'attachment; filename="cmaps_export.geojson"'},
    )
