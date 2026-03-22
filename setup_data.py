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


# ── ADM0_A3 fallback mappings → flagcdn ISO A2 codes ─────────────────────
# Used when a country has no valid ISO A2 but we know its ADM0_A3 code
_ADM0_A3_TO_FLAGCDN = {
    "XKX": "xk",   # Kosovo
    "TWN": "tw",   # Taiwan
    "PSX": "ps",   # Palestine / West Bank
    "GAZ": "ps",   # Gaza
    "HKG": "hk",   # Hong Kong
    "MAC": "mo",   # Macao
    "PRI": "pr",   # Puerto Rico
    "GUM": "gu",   # Guam
    "VIR": "vi",   # U.S. Virgin Islands
    "ASM": "as",   # American Samoa
    "MNP": "mp",   # Northern Mariana Islands
    "ABW": "aw",   # Aruba
    "CUW": "cw",   # Curacao
    "SXM": "sx",   # Sint Maarten
    "BES": "bq",   # Bonaire / Caribbean NL
    "MAF": "mf",   # Saint Martin (French)
    "BLM": "bl",   # Saint Barthélemy
    "GLP": "gp",   # Guadeloupe
    "MTQ": "mq",   # Martinique
    "GUF": "gf",   # French Guiana
    "REU": "re",   # Réunion
    "MYT": "yt",   # Mayotte
    "SPM": "pm",   # Saint Pierre & Miquelon
    "SHN": "sh",   # Saint Helena / Ascension / Tristan da Cunha
    "IOT": "io",   # British Indian Ocean Territory
    "PCN": "pn",   # Pitcairn Islands
    "TKL": "tk",   # Tokelau
    "NIU": "nu",   # Niue
    "COK": "ck",   # Cook Islands
    "CCK": "cc",   # Cocos (Keeling) Islands
    "CXR": "cx",   # Christmas Island
    "NFK": "nf",   # Norfolk Island
    "ESH": "eh",   # Western Sahara
    "SGS": "gs",   # South Georgia
    "ATF": "tf",   # French Southern Territories
    "HMD": "hm",   # Heard & McDonald Islands
    "ATA": None,   # Antarctica — no flag, skip
    "CLP": None,   # Clipperton Island — no standard flag
}


def _try_download_flag(code: str) -> bool:
    """Attempt to download a flag PNG for the given lowercase ISO A2 code.
    Returns True if the file already exists or was successfully downloaded."""
    if not code or len(code) != 2:
        return False
    code = code.lower()
    filepath = os.path.join(FLAGS_DIR, f"{code}.png")
    if os.path.exists(filepath) and os.path.getsize(filepath) > 100:
        return True
    os.makedirs(FLAGS_DIR, exist_ok=True)
    url = f"https://flagcdn.com/w320/{code}.png"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CMaps/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
        if len(data) < 200:   # flagcdn returns tiny placeholder for unknown codes
            return False
        with open(filepath, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False


def fill_missing_flags(db) -> int:
    """Scan countries that have no flag_url and try to download their flags.
    Returns the number of countries updated."""
    from database import Country

    missing = db.query(Country).filter(
        (Country.flag_url == None) | (Country.flag_url == '')
    ).all()

    if not missing:
        return 0

    print(f"  Filling missing flags for {len(missing)} countries...")
    updated = 0

    for country in missing:
        iso2 = (country.iso_code or "").lower().strip()
        iso3 = (country.iso_a3 or "").upper().strip()

        # Build ordered list of codes to try
        candidates = []
        if iso2 and iso2 != "-99" and len(iso2) == 2:
            candidates.append(iso2)

        # ADM0_A3 lookup
        mapped = _ADM0_A3_TO_FLAGCDN.get(iso3)
        if mapped is not None and mapped not in candidates:
            candidates.append(mapped)
        elif mapped is None and iso3 in _ADM0_A3_TO_FLAGCDN:
            continue  # Explicitly marked as "no flag" (Antarctica etc.)

        # Truncated iso_a3 as last resort
        if iso3 and len(iso3) >= 2:
            fb = iso3[:2].lower()
            if fb not in candidates:
                candidates.append(fb)

        for code in candidates:
            if _try_download_flag(code):
                country.flag_url = f"/static/data/flags/{code}.png"
                updated += 1
                break

    if updated:
        db.commit()
        print(f"  ✓ Filled {updated} missing flag(s)")
    else:
        print(f"  ✓ No additional flags found (network may be unavailable)")
    return updated


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
        # Load countries first (50m has more countries including microstates)
        countries_path = os.path.join(
            DATA_DIR, DATASETS["countries_50m"]["filename"])
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
    countries_path = os.path.join(DATA_DIR, DATASETS["countries_50m"]["filename"])
    if not os.path.exists(countries_path):
        # Fallback to 110m
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
    countries_50m = os.path.join(DATA_DIR, DATASETS["countries_50m"]["filename"])
    countries_110m = os.path.join(DATA_DIR, DATASETS["countries_110m"]["filename"])
    cities = os.path.join(DATA_DIR, DATASETS["cities"]["filename"])
    return (os.path.exists(countries_50m) or os.path.exists(countries_110m)) and os.path.exists(cities)


if __name__ == "__main__":
    import sys
    if "--flags" in sys.argv:
        reseed_flags()
    else:
        setup_data()
