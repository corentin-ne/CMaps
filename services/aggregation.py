"""
CMaps Aggregation Engine — Parent-child data recalculation.
Country stats = Σ Region stats (population, area, GDP).
"""
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import Country, Region


def recalculate_country(db: Session, country_id: int, skip_geometry: bool = False) -> dict:
    """
    Recalculate a country's aggregated stats from its child regions.
    Returns a dict of the updated values.
    When skip_geometry=True, skips expensive Shapely geometry merge (for rapid edits).
    """
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        return {}

    # Aggregate from regions
    result = db.query(
        func.sum(Region.population).label('total_pop'),
        func.sum(Region.area_km2).label('total_area'),
    ).filter(Region.country_id == country_id).first()

    total_pop = result.total_pop or 0
    total_area = result.total_area or 0.0

    # Only update if we have regions with data
    region_count = db.query(Region).filter(Region.country_id == country_id).count()
    if region_count > 0:
        # If regions have population data, use aggregated values
        if total_pop > 0:
            country.population = total_pop
        if total_area > 0:
            country.area_km2 = total_area

        if not skip_geometry:
            # Update geometry by merging region geometries (expensive!)
            from services.geo_utils import merge_polygons
            import json
            regions = db.query(Region).filter(Region.country_id == country_id).all()
            geoms = [json.loads(r.geometry) if isinstance(r.geometry, str) else r.geometry for r in regions]
            if geoms:
                merged_geom = merge_polygons(geoms)
                if merged_geom:
                    country.geometry = json.dumps(merged_geom)

    db.commit()
    db.refresh(country)

    return {
        'population': country.population,
        'area_km2': country.area_km2,
        'region_count': region_count,
    }


def propagate_region_change(db: Session, region_id: int):
    """
    After a region is updated, recalculate its parent country's stats.
    """
    region = db.query(Region).filter(Region.id == region_id).first()
    if region and region.country_id:
        recalculate_country(db, region.country_id)


def reassign_region(db: Session, region_id: int, new_country_id: int, old_country_id: int = None, defer_geometry: bool = False):
    """
    Move a region from one country to another and recalculate both.
    When defer_geometry=True, skips expensive geometry merge for rapid batch operations.
    """
    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        return

    old_id = old_country_id or region.country_id
    region.country_id = new_country_id
    db.commit()

    # Recalculate both old and new parent
    if old_id:
        recalculate_country(db, old_id, skip_geometry=defer_geometry)
    recalculate_country(db, new_country_id, skip_geometry=defer_geometry)
