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
        adm0_a3 = props.get("ADM0_A3", props.get("adm0_a3", ""))

        if name in ("Unknown", "") or not geometry.get("coordinates"):
            continue

        iso_code = (iso_a2 if iso_a2 and iso_a2 != "-99"
                    else (iso_a3[:2] if iso_a3 and iso_a3 != "-99" else None))

        # Build a robust 3-letter code fallback
        final_iso_a3 = iso_a3 if iso_a3 and iso_a3 != "-99" else adm0_a3

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
            iso_a3=final_iso_a3 if final_iso_a3 and final_iso_a3 != "-99" else None,
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

    # Build robust lookups mapping ISO2, ISO3, and Admin Name directly to Country ID
    country_lookup_iso2 = {}
    country_lookup_iso3 = {}
    country_lookup_name = {}
    
    for c in db.query(Country).all():
        if c.iso_code:
            country_lookup_iso2[c.iso_code.upper()] = c.id
        if c.iso_a3:
            country_lookup_iso3[c.iso_a3.upper()] = c.id
        country_lookup_name[c.name.lower()] = c.id

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

        iso_country = (props.get("iso_a2", "") or props.get("ISO_A2", "") or "").upper()
        adm0_a3 = (props.get("adm0_a3", "") or props.get("ADM0_A3", "") or "").upper()
        admin_name = (props.get("admin", "") or props.get("ADMIN", "") or "").lower()

        iso_code = (props.get("iso_3166_2", "") or props.get("code_hasc", "") or "")

        # Try to resolve country ID cascading through identifiers
        country_id = None
        if iso_country and iso_country != "-99":
            country_id = country_lookup_iso2.get(iso_country)
            
        if not country_id and adm0_a3 and adm0_a3 != "-99":
            country_id = country_lookup_iso3.get(adm0_a3)
            
        if not country_id and admin_name:
            country_id = country_lookup_name.get(admin_name)

        region_type = (props.get("type_en", "") or
                       props.get("TYPE", "") or
                       props.get("type", "") or
                       "region")

        # Handle MultiPolygons to split macro-regions into finer polygons (islands, exclaves)
        geoms_to_process = []
        if geometry.get("type") == "MultiPolygon":
            for coords in geometry.get("coordinates", []):
                geoms_to_process.append({"type": "Polygon", "coordinates": coords})
        else:
            geoms_to_process.append(geometry)

        for i, geom in enumerate(geoms_to_process):
            area_km2 = calculate_area_km2(geom)
            # Skip tiny artifacts unless it's the only one
            if len(geoms_to_process) > 1 and area_km2 < 0.5:
                continue

            part_name = name if len(geoms_to_process) == 1 else f"{name} ({i+1})"
            
            region = Region(
                name=part_name[:100],
                country_id=country_id,
                iso_code=iso_code[:20] if iso_code else None,
                iso_country=iso_country[:10] if iso_country and iso_country != "-99" else None,
                geometry=json.dumps(geom),
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

    # Build robust lookup: mapping Country Name & ADM0_A3 directly to Country ID
    country_lookup_name = {}
    country_lookup_iso3 = {}
    for c in db.query(Country).all():
        country_lookup_name[c.name.lower()] = c.id
        if c.iso_a3:
            country_lookup_iso3[c.iso_a3.upper()] = c.id

    loaded = 0
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree
    
    # Preload regions and build spatial index
    all_regions = db.query(Region).all()
    region_shapes = []
    
    for r in all_regions:
        geom_dict = json.loads(r.geometry) if isinstance(r.geometry, str) else r.geometry
        if geom_dict:
            try:
                region_shapes.append(shape(geom_dict))
            except Exception:
                region_shapes.append(None)
        else:
            region_shapes.append(None)
            
    valid_indices = [i for i, s in enumerate(region_shapes) if s is not None]
    tree = STRtree([region_shapes[i] for i in valid_indices]) if valid_indices else None

    for feature in features:
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})

        if not geom or geom.get("type") != "Point":
            continue

        coords = geom.get("coordinates", [0, 0])
        pop = int(props.get("pop_max", 0) or 0)

        # SPATIAL JOIN: Intersect all cities points with Region polygons to attribute population
        if pop > 0 and tree:
            pt = Point(coords[0], coords[1])
            indices = tree.query(pt)
            for idx in indices:
                real_idx = valid_indices[int(idx)]
                r_shape = region_shapes[real_idx]
                if r_shape and r_shape.contains(pt):
                    reg = all_regions[real_idx]
                    reg.population = (reg.population or 0) + pop
                    break

        is_capital = (props.get("adm0cap", 0) == 1 or
                      "capital" in (props.get("featurecla", "") or "").lower())

        if not is_capital:
            continue

        name = props.get("name", "") or props.get("nameascii", "")
        if not name:
            continue

        country_name = props.get("adm0name", "")
        adm0_a3 = (props.get("adm0_a3", "") or props.get("ADM0_A3", "")).upper()

        # Robust entity link mapping
        country_id = None
        if adm0_a3 and adm0_a3 != "-99":
            country_id = country_lookup_iso3.get(adm0_a3)
        if not country_id and country_name:
            country_id = country_lookup_name.get(country_name.lower())

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
        
    # Distribute country baseline populations proportionally to regions to avoid massive undercounts
    for country in db.query(Country).all():
        regions = db.query(Region).filter(Region.country_id == country.id).all()
        if not regions: continue
        
        total_city_pop = sum(r.population or 0 for r in regions)
        remaining_pop = max(0, country.population - total_city_pop)
        total_area = sum(r.area_km2 or 0 for r in regions)
        
        # Distribute remaining
        for r in regions:
            extra = int((r.area_km2 / total_area) * remaining_pop) if total_area > 0 else 0
            r.population = (r.population or 0) + extra
            
        # Ensure perfect sum
        country.population = sum(r.population or 0 for r in regions)
        
    db.commit()

    # Final recalculation for countries since region population changed
    from services.aggregation import recalculate_country
    for country in db.query(Country).all():
        recalculate_country(db, country.id)

    db.commit()
    print(f"  ✓ Loaded {loaded} capitals into database.")
