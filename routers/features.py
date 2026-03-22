"""
CMaps Features Router — Natural features (rivers, mountains, lakes, mountain ranges).
"""
import json
import math
import os
from functools import lru_cache
from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(prefix="/api/features", tags=["features"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "data")

# ── In-memory cache for expensive computed layers ──
_cache: dict = {}


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
    return _load_geojson("ne_10m_rivers_lake_centerlines.geojson")


@router.get("/lakes")
def get_lakes():
    """Get lake polygons GeoJSON."""
    return _load_geojson("ne_10m_lakes.geojson")


@router.get("/mountains")
def get_mountains():
    """Get mountain/elevation points GeoJSON with name and elevation labels."""
    data = _load_geojson("ne_10m_geography_regions_elevation_points.geojson")
    # Filter to significant peaks and normalize properties for the map layer
    if data.get("features"):
        filtered = []
        for f in data["features"]:
            props = f.get("properties", {})
            elevation = props.get("elevation", 0) or 0
            # Include peaks above 500m
            if elevation >= 500:
                name = (props.get("name", "") or
                        props.get("NAME", "") or
                        props.get("name_en", "") or "")
                filtered.append({
                    "type": "Feature",
                    "geometry": f.get("geometry"),
                    "properties": {
                        "name": name,
                        "elevation": int(elevation),
                        "description": props.get("description", ""),
                        "region": props.get("region", ""),
                    }
                })
        data["features"] = filtered
    return data


# ═══════════════════════════════════════════════════════════
#  Mountain Range Zones — proximity-clustered convex hulls
# ═══════════════════════════════════════════════════════════

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Fast haversine distance in km between two points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _cluster_peaks(peaks, eps_km=250.0, min_points=3):
    """
    Simple DBSCAN-style clustering of mountain peaks by geographic proximity.
    Returns list of clusters, each a list of peak dicts with lng/lat/name/elevation.
    """
    n = len(peaks)
    visited = [False] * n
    clusters = []

    for i in range(n):
        if visited[i]:
            continue
        # Find neighbors
        neighbors = []
        for j in range(n):
            if i == j:
                continue
            d = _haversine_km(peaks[i]["lat"], peaks[i]["lng"],
                              peaks[j]["lat"], peaks[j]["lng"])
            if d <= eps_km:
                neighbors.append(j)

        if len(neighbors) < min_points - 1:
            continue  # noise point

        # Expand cluster
        cluster = [peaks[i]]
        visited[i] = True
        queue = list(neighbors)
        while queue:
            idx = queue.pop(0)
            if visited[idx]:
                continue
            visited[idx] = True
            cluster.append(peaks[idx])
            # Expand from this point
            sub_neighbors = []
            for j in range(n):
                if j == idx or visited[j]:
                    continue
                d = _haversine_km(peaks[idx]["lat"], peaks[idx]["lng"],
                                  peaks[j]["lat"], peaks[j]["lng"])
                if d <= eps_km:
                    sub_neighbors.append(j)
            if len(sub_neighbors) >= min_points - 1:
                queue.extend(sub_neighbors)

        if len(cluster) >= min_points:
            clusters.append(cluster)

    return clusters


def _convex_hull_polygon(points):
    """Compute convex hull of 2D points using Graham scan, return as ring of [lng, lat]."""
    if len(points) < 3:
        return []

    # Deduplicate
    pts = list(set(points))
    if len(pts) < 3:
        return []

    # Find lowest point (then leftmost)
    start = min(pts, key=lambda p: (p[1], p[0]))
    pts.remove(start)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def angle_key(p):
        dx = p[0] - start[0]
        dy = p[1] - start[1]
        return (math.atan2(dy, dx), dx * dx + dy * dy)

    pts.sort(key=angle_key)

    hull = [start]
    for p in pts:
        while len(hull) >= 2 and cross(hull[-2], hull[-1], p) <= 0:
            hull.pop()
        hull.append(p)

    if len(hull) < 3:
        return []

    # Close the ring
    ring = [[p[0], p[1]] for p in hull]
    ring.append(ring[0])
    return ring


def _buffer_ring(ring, buffer_deg=1.5):
    """
    Expand a convex hull ring outward by buffer_deg degrees (approx).
    Uses simple centroid-offset expansion.
    """
    if len(ring) < 4:
        return ring

    # Compute centroid
    n = len(ring) - 1  # exclude closing point
    cx = sum(p[0] for p in ring[:n]) / n
    cy = sum(p[1] for p in ring[:n]) / n

    buffered = []
    for p in ring[:n]:
        dx = p[0] - cx
        dy = p[1] - cy
        dist = math.sqrt(dx * dx + dy * dy)
        if dist < 0.001:
            buffered.append(p)
            continue
        scale = (dist + buffer_deg) / dist
        buffered.append([cx + dx * scale, cy + dy * scale])

    buffered.append(buffered[0])  # close ring
    return buffered


def _name_cluster(cluster):
    """
    Name a mountain range cluster based on the most prominent peaks.
    Uses well-known range associations, then falls back to the highest peak name.
    """
    # Well-known peak → range name associations
    KNOWN_RANGES = {
        # Himalayas & Karakoram
        "K2": "Karakoram", "Everest": "Himalayas", "Kangchenjunga": "Himalayas",
        "Kanchenjunga": "Himalayas", "Gangkar Punsum": "Himalayas",
        "Lhotse": "Himalayas", "Makalu": "Himalayas", "Cho Oyu": "Himalayas",
        "Annapurna": "Himalayas", "Dhaulagiri": "Himalayas", "Nanga Parbat": "Karakoram",
        "Tirich Mir": "Karakoram", "Batura": "Karakoram",
        "Nanda Devi": "Western Himalayas", "Kailash": "Western Himalayas",
        "Namcha Barwa": "Eastern Himalayas", "Gyala Peri": "Eastern Himalayas",
        # European ranges
        "Mont Blanc": "Alps", "Matterhorn": "Alps", "Monte Rosa": "Alps",
        "Jungfrau": "Alps", "Eiger": "Alps", "Grossglockner": "Alps",
        "Finsteraarhorn": "Alps",
        "Musala": "Balkans", "Olympus": "Balkans", "Korab": "Balkans",
        "Corno Grande": "Apennines", "Vesuvio": "Apennines", "Monte Viglio": "Apennines",
        "Pico de Aneto": "Pyrenees", "Coma Pedrosa": "Pyrenees", "Moncayo": "Pyrenees",
        "Torre de Cerredo": "Cantabrian Mountains",
        "Signal de Botrange": "Ardennes–Eifel", "Hohe Acht": "Ardennes–Eifel",
        "Gerlachovský": "Carpathians", "Moldoveanu": "Carpathians",
        # Caucasus
        "Elbrus": "Caucasus", "Kazbek": "Caucasus", "Shkhara": "Caucasus",
        # Central Asia
        "Pik Pobeda": "Tian Shan", "Khan Tengri": "Tian Shan", "Pik Talgar": "Tian Shan",
        "Pik BAM": "Siberian Mountains", "Skalistyy": "Siberian Mountains",
        "Inyaptuk": "Siberian Mountains",
        "Ayrybaba": "Pamir-Alai",
        # Middle East & South Asia
        "Zard Kuh": "Zagros Mountains", "Kuh-e Dinar": "Zagros Mountains",
        "Kuh-e Hezar": "Iranian Plateau",
        "Qurnat as Sawdā": "Levant Mountains",
        "Anai Mudi": "Western Ghats", "Doda Betta": "Western Ghats",
        "Mount Victoria": "Chin Hills",
        # East Asia
        "Taibai Shan": "Qinling Mountains", "Hua Shan": "Qinling Mountains",
        "Daxue Shan": "Hengduan Mountains", "Loi Leng": "Hengduan Mountains",
        "Paektu-san": "Changbai Mountains",
        "Kuju-san": "Kyushu Volcanic Arc",
        # Africa
        "Emi Koussi": "Tibesti Mountains",
        "Karisimbi": "Virunga Mountains", "Mont Mohi": "Virunga Mountains",
        "Mount Oku": "Cameroon Highlands", "Chappal Wadi": "Cameroon Highlands",
        "Mtorwi": "East African Rift Mountains",
        "Loma Mansa": "Guinea Highlands", "Mount Wuteve": "Guinea Highlands",
        "Mount Batu": "Ethiopian Highlands", "Gugu": "Ethiopian Highlands",
        "Kilimanjaro": "East African Highlands", "Kenya": "East African Highlands",
        # Americas
        "Aconcagua": "Andes", "Huascarán": "Andes", "Chimborazo": "Andes",
        "Cotopaxi": "Andes", "Ojos del Salado": "Andes", "Tupungato": "Andes",
        "Monte Fitz Roy": "Patagonian Andes", "Torres del Paine": "Patagonian Andes",
        "Mount Logan": "Saint Elias Mountains", "Fairweather": "Saint Elias Mountains",
        "Denali": "Alaska Range", "Rainier": "Cascades",
        "Grand Teton": "Rocky Mountains", "Borah Peak": "Rocky Mountains",
        "Mount Elbert": "Rocky Mountains (Colorado)", "Longs Peak": "Rocky Mountains (Colorado)",
        "Mount Mitchell": "Appalachian Mountains", "Clingmans Dome": "Appalachian Mountains",
        "Mount Washington": "Appalachian Mountains (North)",
        "Mount Marcy": "Appalachian Mountains (North)",
        "Keele Peak": "Mackenzie Mountains", "Mount Nirvana": "Mackenzie Mountains",
        "Ulysses": "Northern Rockies (BC)",
        "Sierra El Viejo": "Sierra Madre Oriental",
        "Cerro Las Minas": "Central American Highlands",
        "La Soufrière": "Caribbean Volcanic Arc", "Soufrière Hills": "Caribbean Volcanic Arc",
        "Pelée": "Caribbean Volcanic Arc", "Cerro de Punta": "Caribbean Volcanic Arc",
        # Oceania
        "Mount Kosciuszko": "Great Dividing Range",
        "Round Mountain": "Great Dividing Range (North)",
        "Barrington": "Great Dividing Range (North)",
        "Gunung Rinjani": "Lesser Sunda Islands",
        "Puncak Jaya": "New Guinea Highlands",
        "Kinabalu": "Borneo Highlands",
        "Pulog": "Philippine Cordillera", "Pinatubo": "Philippine Cordillera",
        "Mount Kirkpatrick": "Transantarctic Mountains",
        # Atlantic
        "Teide": "Atlantic Volcanic Islands",
        "Fuji": "Japanese Alps",
    }

    sorted_peaks = sorted(cluster, key=lambda p: p.get("elevation", 0), reverse=True)

    # Check for known range associations first
    for peak in sorted_peaks[:15]:
        pname = peak.get("name", "")
        for key, range_name in KNOWN_RANGES.items():
            if key.lower() in pname.lower():
                return range_name

    # Check for range keywords in peak names
    range_keywords = ["Range", "Mountains", "Alps", "Andes", "Himalayas",
                      "Sierra", "Cordillera", "Serra", "Massif", "Altai",
                      "Carpathian", "Karakoram", "Hindu Kush", "Caucasus",
                      "Urals", "Rockies", "Appalachian", "Atlas", "Pyrenees",
                      "Taurus", "Zagros", "Kunlun", "Tian Shan", "Pamir"]
    for peak in sorted_peaks[:10]:
        pname = peak.get("name", "")
        for kw in range_keywords:
            if kw.lower() in pname.lower():
                return pname

    # Fallback: use highest peak name + "Range"
    top = sorted_peaks[0]
    name = top.get("name", "")
    for suffix in [" Peak", " Mt.", " Mountain", " Mount", " Pk."]:
        if name.endswith(suffix):
            name = name[:-len(suffix)]
            break

    if name:
        return f"{name} Range"
    return "Mountain Range"


def _build_mountain_ranges() -> dict:
    """Build mountain range polygons by clustering peaks and creating convex hulls."""
    data = _load_geojson("ne_10m_geography_regions_elevation_points.geojson")

    peaks = []
    for f in (data.get("features") or []):
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        elevation = props.get("elevation", 0) or 0
        featurecla = (props.get("featurecla", "") or "").lower()

        # Only cluster actual mountains with reasonable elevation
        if featurecla not in ("mountain", "range/mtn", "plateau") and elevation < 800:
            continue
        if elevation < 500:
            continue

        coords = geom.get("coordinates", [])
        if not coords or len(coords) < 2:
            continue

        name = (props.get("name", "") or props.get("NAME", "") or
                props.get("name_en", "") or "")

        peaks.append({
            "lng": coords[0],
            "lat": coords[1],
            "name": name,
            "elevation": int(elevation),
        })

    if not peaks:
        return {"type": "FeatureCollection", "features": []}

    # Cluster peaks into mountain ranges
    clusters = _cluster_peaks(peaks, eps_km=250.0, min_points=3)

    features = []
    for cluster in clusters:
        points = [(p["lng"], p["lat"]) for p in cluster]
        ring = _convex_hull_polygon(points)
        if not ring:
            continue

        # Buffer outward for visual appeal
        buffered = _buffer_ring(ring, buffer_deg=1.2)

        # Compute stats
        max_elev = max(p["elevation"] for p in cluster)
        avg_elev = int(sum(p["elevation"] for p in cluster) / len(cluster))
        range_name = _name_cluster(cluster)

        # Centroid for label placement
        n = len(buffered) - 1
        cx = sum(p[0] for p in buffered[:n]) / n
        cy = sum(p[1] for p in buffered[:n]) / n

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [buffered]
            },
            "properties": {
                "name": range_name,
                "peak_count": len(cluster),
                "max_elevation": max_elev,
                "avg_elevation": avg_elev,
                "centroid": [cx, cy],
            }
        })

    # Sort by peak count descending so major ranges come first
    features.sort(key=lambda f: f["properties"]["peak_count"], reverse=True)

    return {"type": "FeatureCollection", "features": features}


@router.get("/mountain-ranges")
def get_mountain_ranges():
    """Get mountain range polygon zones as GeoJSON (clustered from peak data)."""
    if "mountain_ranges" not in _cache:
        _cache["mountain_ranges"] = _build_mountain_ranges()
    return _cache["mountain_ranges"]
