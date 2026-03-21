"""
CMaps Features Router — Natural features (rivers, mountains, lakes).
"""
import json
import os
from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(prefix="/api/features", tags=["features"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "data")


def _load_geojson(filename: str) -> dict:
    """Load a GeoJSON file from the data directory."""
    filepath = os.path.join(DATA_DIR, filename)
    if not os.path.exists(filepath):
        return {"type": "FeatureCollection", "features": []}
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("/rivers")
def get_rivers():
    """Get river lines GeoJSON."""
    return _load_geojson("ne_110m_rivers_lake_centerlines.geojson")


@router.get("/lakes")
def get_lakes():
    """Get lake polygons GeoJSON."""
    return _load_geojson("ne_110m_lakes.geojson")


@router.get("/mountains")
def get_mountains():
    """Get mountain/elevation points GeoJSON."""
    data = _load_geojson("ne_10m_geography_regions_elevation_points.geojson")
    # Filter to only include significant peaks
    if data.get("features"):
        filtered = []
        for f in data["features"]:
            props = f.get("properties", {})
            elevation = props.get("elevation", 0) or 0
            # Include peaks above 1000m
            if elevation >= 1000:
                filtered.append(f)
        data["features"] = filtered
    return data
