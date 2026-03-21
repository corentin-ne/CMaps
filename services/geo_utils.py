"""
CMaps Geo Utilities — Geometric operations for country management.
"""
import random
import math
from shapely.geometry import shape, mapping, LineString, MultiPolygon, Polygon
from shapely.ops import split, unary_union


# Pastel color palette for countries
COUNTRY_COLORS = [
    "#7c9eb2", "#9b8ea7", "#8fbc8f", "#c4a882", "#b8860b",
    "#6b8e8e", "#a0785a", "#8b7d9b", "#7a9a6f", "#b89b72",
    "#6e8b9e", "#9c8b75", "#7d9b8f", "#a8876e", "#8a9a7c",
    "#9b7e8a", "#7c8e6b", "#a89b8c", "#6d8a7e", "#8c7b6a",
    "#7b9e7a", "#9a8b7d", "#8d7c9a", "#a0896e", "#6e9b8a",
    "#8b8e7c", "#9c7a6d", "#7d8b9e", "#a88c7b", "#6b9a7d",
]

_color_index = 0


def generate_color() -> str:
    """Generate a unique pastel color for a country."""
    global _color_index
    color = COUNTRY_COLORS[_color_index % len(COUNTRY_COLORS)]
    _color_index += 1
    return color


def calculate_area_km2(geojson_geometry: dict) -> float:
    """
    Calculate the approximate area of a GeoJSON geometry in km².
    Uses a simple spherical approximation.
    """
    try:
        geom = shape(geojson_geometry)
        # Convert from degrees² to km² (approximate)
        # At the equator, 1 degree ≈ 111.32 km
        # Area correction factor using centroid latitude
        centroid = geom.centroid
        lat_rad = math.radians(centroid.y)
        # Area in degrees², then convert
        area_deg2 = geom.area
        km_per_deg_lat = 111.32
        km_per_deg_lon = 111.32 * math.cos(lat_rad)
        area_km2 = area_deg2 * km_per_deg_lat * km_per_deg_lon
        return round(area_km2, 2)
    except Exception:
        return 0.0


def split_polygon(polygon_geojson: dict, line_geojson: dict) -> list:
    """
    Split a polygon along a line. Returns list of GeoJSON geometries.
    Used for splitting countries along natural borders.
    """
    try:
        poly = shape(polygon_geojson)
        line = shape(line_geojson)

        # Extend line slightly beyond polygon bounds to ensure clean split
        if not line.intersects(poly):
            return [polygon_geojson]

        result = split(poly, line)
        return [mapping(geom) for geom in result.geoms]
    except Exception:
        return [polygon_geojson]


def merge_polygons(geometries: list) -> dict:
    """
    Merge multiple GeoJSON geometries into one.
    Used for joining countries/regions together.
    """
    try:
        shapes = [shape(g) for g in geometries]
        merged = unary_union(shapes)
        return mapping(merged)
    except Exception:
        return geometries[0] if geometries else None


def validate_geojson(data: dict) -> bool:
    """Validate that data is a valid GeoJSON geometry."""
    try:
        if "type" not in data:
            return False
        valid_types = ["Point", "MultiPoint", "LineString", "MultiLineString",
                       "Polygon", "MultiPolygon", "GeometryCollection"]
        if data["type"] not in valid_types:
            return False
        geom = shape(data)
        return geom.is_valid
    except Exception:
        return False


def get_centroid(geojson_geometry: dict) -> tuple:
    """Get the centroid [lng, lat] of a geometry."""
    try:
        geom = shape(geojson_geometry)
        c = geom.centroid
        return (round(c.x, 4), round(c.y, 4))
    except Exception:
        return (0, 0)


def point_in_polygon(lng: float, lat: float, geojson_geometry: dict) -> bool:
    """Check if a point is inside a polygon."""
    try:
        from shapely.geometry import Point
        geom = shape(geojson_geometry)
        point = Point(lng, lat)
        return geom.contains(point)
    except Exception:
        return False
