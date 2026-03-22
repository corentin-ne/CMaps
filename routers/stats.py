"""
CMaps Stats Router — Global statistics and leaderboard data.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db, Country, Region

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/leaderboard")
def get_leaderboard(limit: int = 5, db: Session = Depends(get_db)):
    """Get top countries by population, area, GDP, and region count."""

    # By Population
    by_pop = (db.query(Country)
              .filter(Country.population > 0)
              .order_by(Country.population.desc())
              .limit(limit)
              .all())

    # By Area
    by_area = (db.query(Country)
               .filter(Country.area_km2 > 0)
               .order_by(Country.area_km2.desc())
               .limit(limit)
               .all())

    # By GDP
    by_gdp = (db.query(Country)
              .filter(Country.gdp_md != None, Country.gdp_md > 0)
              .order_by(Country.gdp_md.desc())
              .limit(limit)
              .all())

    # By Region Count
    region_counts = (db.query(
        Region.country_id,
        func.count(Region.id).label('count')
    ).filter(Region.country_id != None)
     .group_by(Region.country_id)
     .order_by(func.count(Region.id).desc())
     .limit(limit)
     .all())

    by_regions = []
    for rc in region_counts:
        country = db.query(Country).filter(Country.id == rc.country_id).first()
        if country:
            by_regions.append({
                'id': country.id,
                'name': country.name,
                'flag': country.flag_emoji,
                'value': rc.count,
            })

    # Global aggregates
    global_stats = db.query(
        func.count(Country.id).label('total_countries'),
        func.sum(Country.population).label('total_population'),
        func.sum(Country.area_km2).label('total_area'),
    ).first()

    return {
        'by_population': [
            {'id': c.id, 'name': c.name, 'flag': c.flag_emoji, 'value': c.population}
            for c in by_pop
        ],
        'by_area': [
            {'id': c.id, 'name': c.name, 'flag': c.flag_emoji, 'value': c.area_km2}
            for c in by_area
        ],
        'by_gdp': [
            {'id': c.id, 'name': c.name, 'flag': c.flag_emoji, 'value': c.gdp_md}
            for c in by_gdp
        ],
        'by_regions': by_regions,
        'global': {
            'total_countries': global_stats.total_countries or 0,
            'total_population': global_stats.total_population or 0,
            'total_area': round(global_stats.total_area or 0, 2),
        },
    }


@router.get("/global")
def get_global_stats(db: Session = Depends(get_db)):
    """Get world totals."""
    result = db.query(
        func.count(Country.id).label('total_countries'),
        func.sum(Country.population).label('total_population'),
        func.sum(Country.area_km2).label('total_area'),
        func.sum(Country.gdp_md).label('total_gdp_md'),
    ).first()

    total_regions = db.query(func.count(Region.id)).scalar() or 0

    return {
        'total_countries': result.total_countries or 0,
        'total_population': result.total_population or 0,
        'total_area': round(result.total_area or 0, 2),
        'total_gdp_md': round(result.total_gdp_md or 0, 2),
        'total_regions': total_regions,
    }
