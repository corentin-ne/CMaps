"""
CMaps Regions Router — Admin-1 subdivisions (states, provinces, departments).
"""
import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db, Region

router = APIRouter(prefix="/api/regions", tags=["regions"])


@router.get("/geojson")
def get_regions_geojson(
    country_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Get regions as a GeoJSON FeatureCollection, optionally filtered by country."""
    query = db.query(Region)
    if country_id:
        query = query.filter(Region.country_id == country_id)
    regions = query.all()
    return {
        "type": "FeatureCollection",
        "features": [r.to_geojson_feature() for r in regions],
    }


@router.get("")
def list_regions(
    search: Optional[str] = None,
    country_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List regions without geometry (summary info)."""
    query = db.query(Region)
    if search:
        query = query.filter(Region.name.ilike(f"%{search}%"))
    if country_id:
        query = query.filter(Region.country_id == country_id)
    regions = query.order_by(Region.name).limit(200).all()
    return [r.to_geojson_feature(include_geometry=False) for r in regions]


@router.get("/by-country/{country_id}")
def get_regions_by_country(country_id: int, db: Session = Depends(get_db)):
    """Get all regions for a specific country."""
    regions = (db.query(Region)
               .filter(Region.country_id == country_id)
               .order_by(Region.name)
               .all())
    return {
        "type": "FeatureCollection",
        "features": [r.to_geojson_feature() for r in regions],
    }


@router.get("/search")
def search_regions(q: str = Query("", min_length=1),
                   db: Session = Depends(get_db)):
    """Search regions by name."""
    if not q:
        return {"type": "FeatureCollection", "features": []}
    regions = (db.query(Region)
               .filter(Region.name.ilike(f"%{q}%"))
               .limit(20)
               .all())
    return {
        "type": "FeatureCollection",
        "features": [r.to_geojson_feature(include_geometry=False) for r in regions],
    }


@router.get("/{region_id}")
def get_region(region_id: int, db: Session = Depends(get_db)):
    """Get a single region with full geometry."""
    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Region not found")
    return region.to_geojson_feature()
