"""
CMaps Data Setup — Downloads Natural Earth data files on first run.
"""
import os
import urllib.request
import urllib.error
import json

DATA_DIR = os.path.join(os.path.dirname(__file__), "static", "data")
FLAGS_DIR = os.path.join(DATA_DIR, "flags")

# Natural Earth data sources (GitHub raw URLs)
DATASETS = {
    "countries_110m": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
        "filename": "ne_110m_admin_0_countries.geojson",
        "description": "Country polygons (110m resolution)",
    },
    "countries_50m": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
        "filename": "ne_50m_admin_0_countries.geojson",
        "description": "Country polygons (50m resolution)",
    },
    "regions": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
        "filename": "ne_10m_admin_1_states_provinces.geojson",
        "description": "Admin-1 regions/states/provinces (10m)",
    },
    "rivers": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson",
        "filename": "ne_10m_rivers_lake_centerlines.geojson",
        "description": "Major rivers (10m region)",
    },
    "lakes": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson",
        "filename": "ne_10m_lakes.geojson",
        "description": "Major lakes (10m region)",
    },
    "cities": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
        "filename": "ne_10m_populated_places_simple.geojson",
        "description": "Populated places (cities)",
    },
    "mountains": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_elevation_points.geojson",
        "filename": "ne_10m_geography_regions_elevation_points.geojson",
        "description": "Mountain/elevation points",
    },
}


def download_file(url: str, filepath: str, description: str = "") -> bool:
    """Download a file from URL to local path."""
    if os.path.exists(filepath):
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  ✓ {description} already exists ({size_mb:.1f} MB)")
        return True

    print(f"  ↓ Downloading {description}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CMaps/1.0"})
        with urllib.request.urlopen(req, timeout=120) as response:
            data = response.read()
            with open(filepath, "wb") as f:
                f.write(data)
        size_mb = len(data) / (1024 * 1024)
        print(f"  ✓ {description} ({size_mb:.1f} MB)")
        return True
    except urllib.error.URLError as e:
        print(f"  ✗ Failed to download {description}: {e}")
        return False
    except Exception as e:
        print(f"  ✗ Error downloading {description}: {e}")
        return False


def download_flags(countries_path: str) -> dict:
    """
    Download flag images from flagcdn.com for every country with a valid ISO A2 code.
    Returns a dict mapping ISO A2 (lowercase) -> local relative URL.
    """
    os.makedirs(FLAGS_DIR, exist_ok=True)

    # Check if flags already seeded (heuristic: >50 PNGs present)
    existing = [f for f in os.listdir(FLAGS_DIR) if f.endswith('.png')] if os.path.exists(FLAGS_DIR) else []
    if len(existing) > 50:
        print(f"  ✓ Flags already downloaded ({len(existing)} images)")
        return {f.replace('.png', ''): f"/static/data/flags/{f}" for f in existing}

    # Read ISO codes from the countries GeoJSON
    if not os.path.exists(countries_path):
        print("  ✗ Cannot download flags — countries GeoJSON not found.")
        return {}

    with open(countries_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    iso_codes = set()
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        iso_a2 = props.get("ISO_A2", props.get("iso_a2", ""))
        if iso_a2 and iso_a2 != "-99" and len(iso_a2) == 2:
            iso_codes.add(iso_a2.lower())

    print(f"  ↓ Downloading {len(iso_codes)} flag images from flagcdn.com...")

    flag_map = {}
    downloaded = 0
    failed = 0
    for code in sorted(iso_codes):
        filename = f"{code}.png"
        filepath = os.path.join(FLAGS_DIR, filename)

        if os.path.exists(filepath) and os.path.getsize(filepath) > 100:
            flag_map[code] = f"/static/data/flags/{filename}"
            downloaded += 1
            continue

        # flagcdn.com provides free flag PNGs at various widths
        url = f"https://flagcdn.com/w320/{code}.png"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CMaps/1.0"})
            with urllib.request.urlopen(req, timeout=15) as response:
                img_data = response.read()
                with open(filepath, "wb") as out:
                    out.write(img_data)
            flag_map[code] = f"/static/data/flags/{filename}"
            downloaded += 1
        except Exception:
            failed += 1

    print(f"  ✓ Downloaded {downloaded} flags ({failed} failed)")
    return flag_map


def setup_data():
    """Download all required Natural Earth datasets and seed the database."""
    os.makedirs(DATA_DIR, exist_ok=True)
    print("\n╔══════════════════════════════════════════╗")
    print("║     CMaps — Natural Earth Data Setup     ║")
    print("╚══════════════════════════════════════════╝\n")

    success_count = 0
    for key, dataset in DATASETS.items():
        filepath = os.path.join(DATA_DIR, dataset["filename"])
        if download_file(dataset["url"], filepath, dataset["description"]):
            success_count += 1

    print(f"\n  Downloaded {success_count}/{len(DATASETS)} datasets.")

    if success_count < 2:
        print("  ⚠ Some critical datasets failed to download.")
        print("  ⚠ The app may not work correctly without country and city data.")
        return False

    # Seed the database
    print("\n  Seeding database...")
    from database import init_db, SessionLocal
    from services.data_loader import load_countries, load_regions, load_capitals

    init_db()
    db = SessionLocal()
    try:
        # Load countries first
        countries_path = os.path.join(
            DATA_DIR, DATASETS["countries_110m"]["filename"])
        load_countries(db, countries_path)

        # Load regions
        regions_path = os.path.join(
            DATA_DIR, DATASETS["regions"]["filename"])
        load_regions(db, regions_path)

        # Load capitals from cities dataset
        cities_path = os.path.join(
            DATA_DIR, DATASETS["cities"]["filename"])
        load_capitals(db, cities_path)

        # Download flag images and seed flag_url on countries
        print("\n  Downloading flag images...")
        flag_map = download_flags(countries_path)
        if flag_map:
            seed_flag_urls(db, flag_map)

    finally:
        db.close()

    print("\n  ✓ Data setup complete!\n")
    return True


def seed_flag_urls(db, flag_map: dict):
    """Set flag_url on Country records using the downloaded flag images."""
    from database import Country

    countries = db.query(Country).all()
    updated = 0
    for country in countries:
        iso = (country.iso_code or "").lower()
        if iso and iso in flag_map and not country.flag_url:
            country.flag_url = flag_map[iso]
            updated += 1
    db.commit()
    print(f"  ✓ Set flag_url on {updated} countries.")


def reseed_flags():
    """Download flags and update existing database — can be run standalone."""
    countries_path = os.path.join(DATA_DIR, DATASETS["countries_110m"]["filename"])
    if not os.path.exists(countries_path):
        print("  ✗ Countries GeoJSON not found. Run full setup first.")
        return False

    flag_map = download_flags(countries_path)
    if not flag_map:
        return False

    from database import init_db, SessionLocal
    init_db()
    db = SessionLocal()
    try:
        seed_flag_urls(db, flag_map)
    finally:
        db.close()
    return True


def is_data_ready() -> bool:
    """Check if the essential data files exist."""
    essential = ["countries_110m", "cities"]
    for key in essential:
        filepath = os.path.join(DATA_DIR, DATASETS[key]["filename"])
        if not os.path.exists(filepath):
            return False
    return True


if __name__ == "__main__":
    import sys
    if "--flags" in sys.argv:
        reseed_flags()
    else:
        setup_data()
