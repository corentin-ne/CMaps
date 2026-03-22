"""
CMaps Cities Router — Search endpoint only.
The main cities layer is loaded directly from the static GeoJSON file
by MapLibre on the frontend, bypassing this router entirely.
"""
import json
import os
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/cities", tags=["cities"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "data")

# In-memory cache for search (loaded once on first request)
_raw_features = None


def _ensure_loaded():
    """Load and cache the raw feature list for search."""
    global _raw_features
    if _raw_features is not None:
        return _raw_features

    filepath = os.path.join(DATA_DIR, "ne_10m_populated_places_simple.geojson")
    if not os.path.exists(filepath):
        _raw_features = []
        return _raw_features

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    _raw_features = data.get("features", [])
    return _raw_features


@router.get("/search")
def search_cities(q: str = Query("", min_length=1)):
    """Search for cities by name. Returns max 20 matches."""
    features = _ensure_loaded()
    if not features or not q:
        return {"type": "FeatureCollection", "features": []}

    query = q.lower()
    results = []
    for feature in features:
        props = feature.get("properties") or {}
        name = (props.get("name") or "").lower()
        nameascii = (props.get("nameascii") or "").lower()

        if query in name or query in nameascii:
            results.append({
                "type": "Feature",
                "geometry": feature.get("geometry"),
                "properties": {
                    "name": props.get("name") or "Unknown",
                    "pop_max": props.get("pop_max") or 0,
                    "is_capital": (props.get("adm0cap") or 0) == 1,
                    "country": props.get("adm0name") or "",
                },
            })
            if len(results) >= 20:
                break

    return {"type": "FeatureCollection", "features": results}