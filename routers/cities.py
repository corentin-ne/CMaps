"""
CMaps Cities Router — Cities with zoom-dependent filtering.
"""
import json
import os
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/cities", tags=["cities"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "data")

# Cache loaded data in memory
_cities_cache = None


def _load_cities():
    """Load and cache cities data."""
    global _cities_cache
    if _cities_cache is not None:
        return _cities_cache

    filepath = os.path.join(DATA_DIR, "ne_10m_populated_places_simple.geojson")
    if not os.path.exists(filepath):
        _cities_cache = {"type": "FeatureCollection", "features": []}
        return _cities_cache

    with open(filepath, "r", encoding="utf-8") as f:
        _cities_cache = json.load(f)

    return _cities_cache


@router.get("")
def get_cities(zoom: float = Query(0, description="Current zoom level")):
    """
    Get cities filtered by zoom level.
    - Zoom 0-2:  National capitals only
    - Zoom 2-4:  + Major cities (pop > 1M)
    - Zoom 4-6:  + Large cities (pop > 500K)
    - Zoom 6-8:  + Medium cities (pop > 100K)
    - Zoom 8-10: + Small cities (pop > 50K)
    - Zoom 10+:  All populated places
    """
    data = _load_cities()
    if not data.get("features"):
        return data

    filtered = []
    for feature in data["features"]:
        props = feature.get("properties", {})
        pop = props.get("pop_max", 0) or 0
        is_capital = props.get("adm0cap", 0) == 1 or props.get("featurecla", "").lower().find("capital") >= 0

        include = False
        if zoom < 2:
            include = is_capital
        elif zoom < 4:
            include = is_capital or pop >= 1000000
        elif zoom < 6:
            include = is_capital or pop >= 500000
        elif zoom < 8:
            include = is_capital or pop >= 100000
        elif zoom < 10:
            include = is_capital or pop >= 50000
        else:
            include = True

        if include:
            # Simplify properties for response
            filtered.append({
                "type": "Feature",
                "geometry": feature.get("geometry"),
                "properties": {
                    "name": props.get("name", "Unknown"),
                    "nameascii": props.get("nameascii", ""),
                    "pop_max": pop,
                    "is_capital": is_capital,
                    "country": props.get("adm0name", ""),
                    "iso": props.get("iso_a2", ""),
                    "latitude": props.get("latitude", 0),
                    "longitude": props.get("longitude", 0),
                }
            })

    return {"type": "FeatureCollection", "features": filtered}


@router.get("/search")
def search_cities(q: str = Query("", min_length=1)):
    """Search for cities by name."""
    data = _load_cities()
    if not data.get("features") or not q:
        return {"type": "FeatureCollection", "features": []}

    query = q.lower()
    results = []
    for feature in data["features"]:
        props = feature.get("properties", {})
        name = (props.get("name", "") or "").lower()
        nameascii = (props.get("nameascii", "") or "").lower()
        if query in name or query in nameascii:
            results.append({
                "type": "Feature",
                "geometry": feature.get("geometry"),
                "properties": {
                    "name": props.get("name", "Unknown"),
                    "pop_max": props.get("pop_max", 0),
                    "is_capital": props.get("adm0cap", 0) == 1,
                    "country": props.get("adm0name", ""),
                }
            })
            if len(results) >= 20:
                break

    return {"type": "FeatureCollection", "features": results}
