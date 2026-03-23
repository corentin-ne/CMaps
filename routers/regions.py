"""
CMaps Regions Router — Admin-1 subdivisions (states, provinces, departments).
"""
import json
import os
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db, Region

router = APIRouter(prefix="/api/regions", tags=["regions"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "data")


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


@router.get("/{region_id}/siblings")
def get_region_siblings(region_id: int, db: Session = Depends(get_db)):
    """Get all sibling parts of a multi-part region (same base name)."""
    import re

    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")

    # Extract base name (strip parenthetical suffix like " (Inishmore)" or " (3)")
    base_name = re.sub(r'\s*\([^)]*\)\s*$', '', region.name).strip()

    siblings = (db.query(Region)
                .filter(Region.name.like(f"{base_name}%"))
                .filter(Region.iso_country == region.iso_country)
                .all())

    return {
        "base_name": base_name,
        "parts": [r.to_geojson_feature(include_geometry=False) for r in siblings]
    }


@router.get("/{region_id}")
def get_region(region_id: int, db: Session = Depends(get_db)):
    """Get a single region with full geometry."""
    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")
    return region.to_geojson_feature()


@router.put("/{region_id}")
def update_region(region_id: int, data: dict, db: Session = Depends(get_db)):
    """Update a region's properties."""
    from services.aggregation import propagate_region_change

    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")

    if 'name' in data:
        region.name = data['name']
    if 'population' in data:
        region.population = int(data['population'] or 0)
    if 'area_km2' in data:
        region.area_km2 = float(data['area_km2'] or 0)
    if 'capital_name' in data:
        region.capital_name = data['capital_name']
    if 'color' in data:
        region.color = data['color']

    db.commit()
    db.refresh(region)

    # Recalculate parent country stats
    propagate_region_change(db, region_id)

    return region.to_geojson_feature()


@router.post("/bulk-assign")
def bulk_assign_regions(data: dict, db: Session = Depends(get_db)):
    """Assign multiple regions to a new parent country."""
    from services.aggregation import reassign_region

    region_ids = data.get('region_ids', [])
    target_country_id = data.get('country_id')
    defer_geometry = data.get('defer_geometry', False)

    if not region_ids or not target_country_id:
        raise HTTPException(status_code=400, detail="Provide region_ids and country_id")

    results = []
    for rid in region_ids:
        reassign_region(db, rid, target_country_id, defer_geometry=defer_geometry)
        region = db.query(Region).filter(Region.id == rid).first()
        if region:
            results.append(region.to_geojson_feature(include_geometry=False))

    return {"assigned": len(results), "regions": results}


@router.post("/finalize-geometry")
def finalize_geometry(data: dict, db: Session = Depends(get_db)):
    """Recalculate geometry for a country after batch region operations."""
    from services.aggregation import recalculate_country

    country_id = data.get('country_id')
    if not country_id:
        raise HTTPException(status_code=400, detail="Provide country_id")

    result = recalculate_country(db, country_id, skip_geometry=False)
    return {"status": "ok", **result}


# ═══════════════════════════════════════════════════════
#  RIVERS (for split feature)
# ═══════════════════════════════════════════════════════

@router.get("/rivers-near/{region_id}")
def get_rivers_near_region(region_id: int, db: Session = Depends(get_db)):
    """Find named rivers that intersect or are near a region's bounding box."""
    from shapely.geometry import shape, box
    from shapely.ops import nearest_points

    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")

    region_geom = shape(
        json.loads(region.geometry) if isinstance(region.geometry, str)
        else region.geometry
    )
    bounds = region_geom.bounds  # (minx, miny, maxx, maxy)
    # Expand bbox slightly for nearby rivers
    pad = 0.5
    search_box = box(bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad)

    # Load 10m rivers
    rivers_path = os.path.join(DATA_DIR, "ne_10m_rivers_lake_centerlines.geojson")
    with open(rivers_path, "r", encoding="utf-8") as f:
        rivers_data = json.load(f)

    results = []
    seen_names = set()
    for feat in rivers_data["features"]:
        name = feat["properties"].get("name")
        if not name or name in seen_names:
            continue
        try:
            river_geom = shape(feat["geometry"])
            if river_geom.intersects(search_box):
                intersects_region = river_geom.intersects(region_geom)
                results.append({
                    "name": name,
                    "scalerank": feat["properties"].get("scalerank", 99),
                    "intersects": intersects_region,
                })
                seen_names.add(name)
        except Exception:
            continue

    # Sort: intersecting first, then by scalerank
    results.sort(key=lambda r: (not r["intersects"], r["scalerank"]))
    return results[:30]


@router.post("/{region_id}/split-by-river")
def split_region_by_river(region_id: int, data: dict, db: Session = Depends(get_db)):
    """
    Split a region along a named river line.
    Body: { "river_name": "Loire", "new_names": ["Région Nord", "Région Sud"] }
    Returns the resulting region features.
    """
    from shapely.geometry import shape, mapping, MultiPolygon, Polygon, MultiLineString, LineString
    from shapely.ops import split, unary_union
    from services.geo_utils import calculate_area_km2
    from services.aggregation import propagate_region_change

    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")

    river_name = data.get("river_name")
    new_names = data.get("new_names", [])
    if not river_name:
        raise HTTPException(status_code=400, detail="Provide river_name")

    # Load river geometry (merge all segments with same name)
    rivers_path = os.path.join(DATA_DIR, "ne_10m_rivers_lake_centerlines.geojson")
    with open(rivers_path, "r", encoding="utf-8") as f:
        rivers_data = json.load(f)

    river_lines = []
    for feat in rivers_data["features"]:
        if feat["properties"].get("name") == river_name:
            geom = shape(feat["geometry"])
            if isinstance(geom, MultiLineString):
                river_lines.extend(geom.geoms)
            elif isinstance(geom, LineString):
                river_lines.append(geom)

    if not river_lines:
        raise HTTPException(status_code=404, detail=f"River '{river_name}' not found")

    river_merged = unary_union(river_lines) if len(river_lines) > 1 else river_lines[0]

    # Load region geometry
    region_geom = shape(
        json.loads(region.geometry) if isinstance(region.geometry, str)
        else region.geometry
    )

    # Extend river line beyond region bounds for clean split
    bounds = region_geom.bounds
    dx = (bounds[2] - bounds[0]) * 0.5
    dy = (bounds[3] - bounds[1]) * 0.5

    if not river_merged.intersects(region_geom):
        raise HTTPException(status_code=400, detail="River does not intersect this region")

    # Attempt split
    try:
        result = split(region_geom, river_merged)
        parts = list(result.geoms)
    except Exception:
        # If split fails, try buffering the river slightly
        try:
            buffered = river_merged.buffer(0.001)
            diff = region_geom.difference(buffered)
            if diff.is_empty:
                raise HTTPException(status_code=400,
                                    detail="Split produced no valid pieces")
            if isinstance(diff, (Polygon, MultiPolygon)):
                if isinstance(diff, MultiPolygon):
                    parts = list(diff.geoms)
                else:
                    parts = [diff]
            else:
                raise HTTPException(status_code=400,
                                    detail="Split produced invalid geometry")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500,
                                detail=f"Split failed: {str(e)}")

    if len(parts) < 2:
        raise HTTPException(status_code=400,
                            detail="River does not split this region into multiple parts")

    # Sort parts by area (largest first)
    parts.sort(key=lambda p: p.area, reverse=True)

    # Assign names
    while len(new_names) < len(parts):
        new_names.append(f"{region.name} (Part {len(new_names) + 1})")

    # Distribute population proportionally by area
    total_area = sum(p.area for p in parts)
    original_pop = region.population or 0
    original_gdp = region.gdp_md or 0

    # Update original region with first part
    region.geometry = json.dumps(mapping(parts[0]))
    region.name = new_names[0]
    region.area_km2 = calculate_area_km2(mapping(parts[0]))
    if total_area > 0:
        ratio = parts[0].area / total_area
        region.population = int(original_pop * ratio)
        region.gdp_md = round(original_gdp * ratio, 2) if original_gdp else None
    db.commit()
    db.refresh(region)

    result_features = [region.to_geojson_feature()]

    # Create new regions for remaining parts
    for i, part in enumerate(parts[1:], start=1):
        ratio = part.area / total_area if total_area > 0 else 0
        new_region = Region(
            name=new_names[i],
            country_id=region.country_id,
            iso_code=region.iso_code,
            iso_country=region.iso_country,
            geometry=json.dumps(mapping(part)),
            area_km2=calculate_area_km2(mapping(part)),
            population=int(original_pop * ratio),
            gdp_md=round(original_gdp * ratio, 2) if original_gdp else None,
            capital_name=None,
            region_type=region.region_type,
            color=region.color,
        )
        db.add(new_region)
        db.commit()
        db.refresh(new_region)
        result_features.append(new_region.to_geojson_feature())

    # Recalculate parent country
    if region.country_id:
        propagate_region_change(db, region.id)

    return {
        "status": "ok",
        "parts": len(result_features),
        "features": result_features,
    }


@router.delete("/{region_id}")
def delete_region(region_id: int, db: Session = Depends(get_db)):
    """Delete a region entirely."""
    from services.aggregation import propagate_region_change

    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")

    country_id = region.country_id
    db.delete(region)
    db.commit()

    # Recalculate parent country
    if country_id:
        from services.aggregation import recalculate_country
        recalculate_country(db, country_id, skip_geometry=False)

    return {"status": "ok", "deleted_id": region_id}
