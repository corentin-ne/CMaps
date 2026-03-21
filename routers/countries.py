"""
CMaps Countries Router — CRUD operations for countries.
"""
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, Country, EditHistory
from services.geo_utils import (
    calculate_area_km2, split_polygon, merge_polygons,
    validate_geojson, generate_color, get_centroid
)

router = APIRouter(prefix="/api/countries", tags=["countries"])


# --- Pydantic models ---

class CountryCreate(BaseModel):
    name: str
    geometry: dict
    population: int = 0
    capital: Optional[str] = None
    flag_emoji: Optional[str] = "🏳️"
    color: Optional[str] = None
    continent: Optional[str] = None
    subregion: Optional[str] = None

class CountryUpdate(BaseModel):
    name: Optional[str] = None
    geometry: Optional[dict] = None
    population: Optional[int] = None
    capital: Optional[str] = None
    flag_emoji: Optional[str] = None
    color: Optional[str] = None
    continent: Optional[str] = None
    subregion: Optional[str] = None

class MergeRequest(BaseModel):
    country_ids: List[int]
    new_name: str
    keep_id: Optional[int] = None  # Which country's metadata to keep

class SplitRequest(BaseModel):
    line: dict  # GeoJSON LineString to split along
    names: List[str] = []  # Names for the resulting parts


# --- Endpoints ---

@router.get("/geojson")
def get_countries_geojson(db: Session = Depends(get_db)):
    """Get all countries as a GeoJSON FeatureCollection for map rendering."""
    countries = db.query(Country).all()
    features = [c.to_geojson_feature() for c in countries]
    return {
        "type": "FeatureCollection",
        "features": features,
    }


@router.get("")
def list_countries(
    search: Optional[str] = None,
    continent: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List all countries with summary info (no geometry)."""
    query = db.query(Country)
    if search:
        query = query.filter(Country.name.ilike(f"%{search}%"))
    if continent:
        query = query.filter(Country.continent == continent)
    countries = query.order_by(Country.name).all()
    return [c.to_geojson_feature(include_geometry=False) for c in countries]


@router.get("/{country_id}")
def get_country(country_id: int, db: Session = Depends(get_db)):
    """Get a single country with full details including geometry."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")
    feature = country.to_geojson_feature()
    # Add centroid for fly-to
    geom = json.loads(country.geometry) if isinstance(country.geometry, str) else country.geometry
    feature["properties"]["centroid"] = get_centroid(geom)
    return feature


@router.post("")
def create_country(data: CountryCreate, db: Session = Depends(get_db)):
    """Create a new country from a drawn polygon."""
    if not validate_geojson(data.geometry):
        raise HTTPException(status_code=400, detail="Invalid GeoJSON geometry")

    area = calculate_area_km2(data.geometry)
    color = data.color or generate_color()

    country = Country(
        name=data.name,
        geometry=json.dumps(data.geometry),
        population=data.population,
        area_km2=area,
        capital=data.capital,
        flag_emoji=data.flag_emoji or "🏳️",
        color=color,
        continent=data.continent,
        subregion=data.subregion,
        is_custom=True,
    )
    db.add(country)
    db.flush()

    # Record history
    history = EditHistory(
        action="create",
        country_id=country.id,
        after_state=json.dumps(country.to_geojson_feature()),
    )
    db.add(history)
    db.commit()
    db.refresh(country)

    return country.to_geojson_feature()


@router.put("/{country_id}")
def update_country(country_id: int, data: CountryUpdate, db: Session = Depends(get_db)):
    """Update a country's properties or geometry."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")

    before = json.dumps(country.to_geojson_feature())

    if data.name is not None:
        country.name = data.name
    if data.geometry is not None:
        if not validate_geojson(data.geometry):
            raise HTTPException(status_code=400, detail="Invalid GeoJSON geometry")
        country.geometry = json.dumps(data.geometry)
        country.area_km2 = calculate_area_km2(data.geometry)
    if data.population is not None:
        country.population = data.population
    if data.capital is not None:
        country.capital = data.capital
    if data.flag_emoji is not None:
        country.flag_emoji = data.flag_emoji
    if data.color is not None:
        country.color = data.color
    if data.continent is not None:
        country.continent = data.continent
    if data.subregion is not None:
        country.subregion = data.subregion

    # Record history
    history = EditHistory(
        action="update",
        country_id=country.id,
        before_state=before,
        after_state=json.dumps(country.to_geojson_feature()),
    )
    db.add(history)
    db.commit()
    db.refresh(country)

    return country.to_geojson_feature()


@router.delete("/{country_id}")
def delete_country(country_id: int, db: Session = Depends(get_db)):
    """Delete a country."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")

    before = json.dumps(country.to_geojson_feature())

    # Record history
    history = EditHistory(
        action="delete",
        country_id=country.id,
        before_state=before,
    )
    db.add(history)

    db.delete(country)
    db.commit()

    return {"status": "deleted", "id": country_id}


@router.post("/merge")
def merge_countries(data: MergeRequest, db: Session = Depends(get_db)):
    """Merge multiple countries into one."""
    if len(data.country_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 countries to merge")

    countries = db.query(Country).filter(Country.id.in_(data.country_ids)).all()
    if len(countries) != len(data.country_ids):
        raise HTTPException(status_code=404, detail="One or more countries not found")

    # Collect geometries
    geometries = []
    total_pop = 0
    before_states = []
    for c in countries:
        geom = json.loads(c.geometry) if isinstance(c.geometry, str) else c.geometry
        geometries.append(geom)
        total_pop += c.population or 0
        before_states.append(json.dumps(c.to_geojson_feature()))

    # Merge geometries
    merged_geom = merge_polygons(geometries)
    merged_area = calculate_area_km2(merged_geom)

    # Keep first country or specified one, delete the rest
    keep_id = data.keep_id or data.country_ids[0]
    keep_country = db.query(Country).filter(Country.id == keep_id).first()

    keep_country.name = data.new_name
    keep_country.geometry = json.dumps(merged_geom)
    keep_country.area_km2 = merged_area
    keep_country.population = total_pop

    # Delete other countries
    for c in countries:
        if c.id != keep_id:
            db.delete(c)

    # Record history
    history = EditHistory(
        action="merge",
        country_id=keep_id,
        before_state=json.dumps(before_states),
        after_state=json.dumps(keep_country.to_geojson_feature()),
    )
    db.add(history)
    db.commit()
    db.refresh(keep_country)

    return keep_country.to_geojson_feature()


@router.post("/{country_id}/split")
def split_country(country_id: int, data: SplitRequest, db: Session = Depends(get_db)):
    """Split a country along a line (natural border)."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")

    geom = json.loads(country.geometry) if isinstance(country.geometry, str) else country.geometry
    before = json.dumps(country.to_geojson_feature())

    # Split the polygon
    parts = split_polygon(geom, data.line)
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="Line does not split the country. Make sure it crosses the entire territory.")

    # Create new countries for each part
    results = []
    for i, part_geom in enumerate(parts):
        name = data.names[i] if i < len(data.names) else f"{country.name} ({i + 1})"
        area = calculate_area_km2(part_geom)
        # Distribute population proportionally by area
        total_area = sum(calculate_area_km2(p) for p in parts)
        pop_share = int((area / total_area) * (country.population or 0)) if total_area > 0 else 0

        if i == 0:
            # Update existing country with first part
            country.name = name
            country.geometry = json.dumps(part_geom)
            country.area_km2 = area
            country.population = pop_share
            db.flush()
            results.append(country.to_geojson_feature())
        else:
            # Create new country for other parts
            new_country = Country(
                name=name,
                geometry=json.dumps(part_geom),
                population=pop_share,
                area_km2=area,
                flag_emoji="🏳️",
                color=generate_color(),
                continent=country.continent,
                subregion=country.subregion,
                is_custom=True,
            )
            db.add(new_country)
            db.flush()
            results.append(new_country.to_geojson_feature())

    # Record history
    history = EditHistory(
        action="split",
        country_id=country.id,
        before_state=before,
        after_state=json.dumps(results),
    )
    db.add(history)
    db.commit()

    return {"parts": results}


@router.get("/history/recent")
def get_recent_history(limit: int = Query(50, le=100), db: Session = Depends(get_db)):
    """Get recent edit history."""
    entries = db.query(EditHistory).order_by(EditHistory.timestamp.desc()).limit(limit).all()
    return [{
        "id": e.id,
        "action": e.action,
        "country_id": e.country_id,
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
    } for e in entries]
