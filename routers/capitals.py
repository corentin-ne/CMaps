"""
CMaps Capitals Router — Country and regional capital cities.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db, Capital

router = APIRouter(prefix="/api/capitals", tags=["capitals"])


@router.get("")
def get_capitals(
    zoom: float = Query(0, description="Current zoom level"),
    db: Session = Depends(get_db),
):
    """
    Get capitals filtered by zoom level.
    - Zoom 0-3:  Country capitals only
    - Zoom 3-6:  + Regional capitals (pop > 500K)
    - Zoom 6+:   All capitals
    """
    query = db.query(Capital)

    if zoom < 3:
        query = query.filter(Capital.is_country_capital == True)
    elif zoom < 6:
        query = query.filter(
            (Capital.is_country_capital == True) |
            (Capital.population >= 500000)
        )

    capitals = query.all()
    return {
        "type": "FeatureCollection",
        "features": [c.to_geojson_feature() for c in capitals],
    }


@router.get("/search")
def search_capitals(q: str = Query("", min_length=1),
                    db: Session = Depends(get_db)):
    """Search capitals by name."""
    if not q:
        return {"type": "FeatureCollection", "features": []}
    caps = (db.query(Capital)
            .filter(Capital.name.ilike(f"%{q}%"))
            .limit(20)
            .all())
    return {
        "type": "FeatureCollection",
        "features": [c.to_geojson_feature() for c in caps],
    }


@router.get("/by-country/{country_id}")
def get_capitals_by_country(country_id: int,
                            db: Session = Depends(get_db)):
    """Get all capitals for a specific country."""
    caps = (db.query(Capital)
            .filter(Capital.country_id == country_id)
            .order_by(Capital.is_country_capital.desc(), Capital.population.desc())
            .all())
    return {
        "type": "FeatureCollection",
        "features": [c.to_geojson_feature() for c in caps],
    }
