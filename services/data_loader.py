"""
CMaps Data Loader — Loads Natural Earth data into the database.
Handles countries, regions (admin level 1), and capitals.
"""
import json
import os
from sqlalchemy.orm import Session
from database import Country, Region, Capital
from services.geo_utils import generate_color, calculate_area_km2


# ═══════════════════════════════════════════════════════
#  EMOJI FLAGS
# ═══════════════════════════════════════════════════════

def iso_to_flag(iso_a2: str) -> str:
    """Convert ISO A2 code to flag emoji via regional indicator symbols."""
    if not iso_a2 or iso_a2 == "-99" or len(iso_a2) != 2:
        return "🏳️"
    try:
        return (chr(0x1F1E6 + ord(iso_a2[0].upper()) - ord('A')) +
                chr(0x1F1E6 + ord(iso_a2[1].upper()) - ord('A')))
    except Exception:
        return "🏳️"


# ═══════════════════════════════════════════════════════
#  LOAD COUNTRIES
# ═══════════════════════════════════════════════════════

def load_countries(db: Session, geojson_path: str):
    """Load country data from Natural Earth GeoJSON into the database."""
    if db.query(Country).count() > 0:
        print("  Countries already loaded, skipping.")
        return

    if not os.path.exists(geojson_path):
        print(f"  Country data file not found: {geojson_path}")
        return

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"  Loading {len(features)} countries...")

    for feature in features:
        props = feature.get("properties", {})
        geometry = feature.get("geometry")

        if not geometry:
            continue

        name = props.get("NAME", props.get("name", "Unknown"))
        iso_a2 = props.get("ISO_A2", props.get("iso_a2", ""))
        iso_a3 = props.get("ISO_A3", props.get("iso_a3", ""))

        if name in ("Unknown", "") or not geometry.get("coordinates"):
            continue

        iso_code = (iso_a2 if iso_a2 and iso_a2 != "-99"
                    else (iso_a3[:2] if iso_a3 and iso_a3 != "-99" else None))

        population = int(props.get("POP_EST", props.get("pop_est", 0)) or 0)
        area_km2 = float(props.get("AREA_KM2", 0) or 0)
        if area_km2 == 0:
            area_km2 = calculate_area_km2(geometry)

        capital_name = props.get("CAPITAL", props.get("capital", None))
        if capital_name == "N/A":
            capital_name = None

        continent = props.get("CONTINENT", props.get("continent", None))
        subregion = props.get("SUBREGION", props.get("subregion", None))
        sovereignty = props.get("SOVEREIGNT", props.get("sovereignt", name))
        gdp_md = float(props.get("GDP_MD", props.get("GDP_MD_EST",
                        props.get("gdp_md_est", 0))) or 0)
        currency = props.get("CURRENCY", props.get("currency", None))
        govt = props.get("GOVT_TYPE", props.get("government", None))

        country = Country(
            name=name,
            iso_code=iso_code,
            iso_a3=iso_a3 if iso_a3 and iso_a3 != "-99" else None,
            geometry=json.dumps(geometry),
            population=population,
            area_km2=area_km2,
            capital=capital_name,
            flag_emoji=iso_to_flag(iso_a2) if iso_a2 else "🏳️",
            color=generate_color(),
            continent=continent,
            subregion=subregion,
            sovereignty=sovereignty,
            gdp_md=gdp_md if gdp_md > 0 else None,
            currency=currency,
            government_type=govt,
            is_custom=False,
        )
        db.add(country)

    db.commit()
    print(f"  ✓ Loaded {db.query(Country).count()} countries into database.")


# ═══════════════════════════════════════════════════════
#  LOAD REGIONS (Admin Level 1)
# ═══════════════════════════════════════════════════════

def load_regions(db: Session, geojson_path: str):
    """Load admin-1 regions from Natural Earth GeoJSON."""
    if db.query(Region).count() > 0:
        print("  Regions already loaded, skipping.")
        return

    if not os.path.exists(geojson_path):
        print(f"  Region data file not found: {geojson_path}")
        return

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"  Loading {len(features)} regions...")

    # Build lookup: iso_code -> country id
    country_lookup = {}
    for c in db.query(Country).all():
        if c.iso_code:
            country_lookup[c.iso_code] = c.id

    loaded = 0
    for feature in features:
        props = feature.get("properties", {})
        geometry = feature.get("geometry")

        if not geometry or not geometry.get("coordinates"):
            continue

        name = (props.get("name", "") or
                props.get("NAME", "") or
                props.get("name_en", "") or
                props.get("gn_name", ""))
        if not name:
            continue

        iso_country = (props.get("iso_a2", "") or
                       props.get("ISO_A2", "") or "")
        if iso_country == "-99":
            iso_country = ""

        iso_code = (props.get("iso_3166_2", "") or
                    props.get("code_hasc", "") or "")

        country_id = country_lookup.get(iso_country)

        region_type = (props.get("type_en", "") or
                       props.get("TYPE", "") or
                       props.get("type", "") or
                       "region")

        area_km2 = calculate_area_km2(geometry)

        region = Region(
            name=name,
            country_id=country_id,
            iso_code=iso_code[:20] if iso_code else None,
            iso_country=iso_country[:10] if iso_country else None,
            geometry=json.dumps(geometry),
            area_km2=area_km2,
            population=0,
            capital_name=None,
            region_type=region_type[:100] if region_type else None,
            color=generate_color(),
        )
        db.add(region)
        loaded += 1

        # Batch commit every 500
        if loaded % 500 == 0:
            db.commit()
            print(f"    ... {loaded} regions loaded")

    db.commit()
    print(f"  ✓ Loaded {db.query(Region).count()} regions into database.")


# ═══════════════════════════════════════════════════════
#  LOAD CAPITALS
# ═══════════════════════════════════════════════════════

def load_capitals(db: Session, cities_path: str):
    """Extract capital cities from populated places dataset."""
    if db.query(Capital).count() > 0:
        print("  Capitals already loaded, skipping.")
        return

    if not os.path.exists(cities_path):
        print(f"  Cities data file not found: {cities_path}")
        return

    with open(cities_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"  Scanning {len(features)} places for capitals...")

    # Build lookup: country name -> country_id
    country_lookup = {}
    for c in db.query(Country).all():
        country_lookup[c.name.lower()] = c.id

    loaded = 0
    for feature in features:
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})

        if not geom or geom.get("type") != "Point":
            continue

        coords = geom.get("coordinates", [0, 0])
        is_capital = (props.get("adm0cap", 0) == 1 or
                      "capital" in (props.get("featurecla", "") or "").lower())

        if not is_capital:
            continue

        name = props.get("name", "") or props.get("nameascii", "")
        if not name:
            continue

        country_name = props.get("adm0name", "")
        pop = int(props.get("pop_max", 0) or 0)

        country_id = country_lookup.get(country_name.lower())

        capital = Capital(
            name=name,
            country_id=country_id,
            country_name=country_name,
            longitude=coords[0],
            latitude=coords[1],
            population=pop,
            is_country_capital=True,
            is_regional_capital=False,
        )
        db.add(capital)
        loaded += 1

    db.commit()
    print(f"  ✓ Loaded {loaded} capitals into database.")
