"""
CMaps Data Loader — Loads Natural Earth data into the database.
Handles countries, regions (admin level 1), and capitals.
Ensures every country is linked to a robust ISO code.
"""
import json
import os
import hashlib
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
#  ISO-CODE HELPER — guarantees every country has a code
# ═══════════════════════════════════════════════════════

# Hard-coded mappings for entities Natural Earth marks as -99
_KNOWN_ISO_OVERRIDES = {
    # ADM0_A3 → (iso_a2, iso_a3)
    "FRA": ("FR", "FRA"),  # France  (ISO_A2='-99' in NE 50m/110m)
    "NOR": ("NO", "NOR"),  # Norway  (ISO_A2='-99' in NE 50m/110m)
    "KOS": ("XK", "XKX"),  # Kosovo
    "TWN": ("TW", "TWN"),  # Taiwan
    "ESH": ("EH", "ESH"),  # Western Sahara
    "PSX": ("PS", "PSE"),  # Palestine
    "GAZ": ("PS", "PSE"),  # Gaza Strip → Palestine
    "WEB": ("PS", "PSE"),  # West Bank → Palestine
    "CYN": ("CY", "CYP"),  # Northern Cyprus → Cyprus (de-jure)
    "SOL": ("SO", "SOM"),  # Somaliland → Somalia (de-jure)
    "SDS": ("SS", "SSD"),  # South Sudan
    "SAH": ("EH", "ESH"),  # Sahrawi Republic → Western Sahara
    "SCR": ("FR", "FRA"),  # Scattered Islands → France
    "BJN": ("BJ", "BJN"),  # Bajo Nuevo Bank
    "SER": ("RS", "SRB"),  # Serranilla Bank
    "USG": ("US", "USA"),  # USNB Guantanamo Bay
    "ATC": ("AU", "AUS"),  # Ashmore and Cartier Islands
    "IOA": ("AU", "AUS"),  # Australian Indian Ocean Territories
    "KAS": ("IN", "IND"),  # Siachen Glacier (admin India)
    "CNM": ("CY", "CYP"),  # Cyprus UNMIK zone
    "CSI": ("FR", "FRA"),  # Coral Sea Islands → France/Australia
    "ALD": ("FI", "FIN"),  # Aland → Finland
    "CLP": ("FR", "FRA"),  # Clipperton Island → France
    "HKG": ("HK", "HKG"),  # Hong Kong
    "MAC": ("MO", "MAC"),  # Macao
}


def _generate_synthetic_iso(name: str, adm0_a3: str) -> tuple:
    """Generate a deterministic synthetic ISO code for an entity without one.
    Returns (iso_a2, iso_a3). Codes start with 'X' to avoid clashing with real ISO."""
    base = adm0_a3 if adm0_a3 and adm0_a3 != "-99" else name[:3].upper()
    # Create a short hash to avoid collisions
    h = hashlib.md5(name.encode()).hexdigest()[:4].upper()
    iso_a2 = f"X{h[0]}"
    iso_a3 = f"X{base[:2]}"
    return iso_a2, iso_a3


def resolve_iso_codes(props: dict) -> tuple:
    """
    Given a Natural Earth properties dict, resolve the best (iso_a2, iso_a3) tuple.
    Always returns non-None values — generates synthetic codes when needed.
    """
    iso_a2 = props.get("ISO_A2", props.get("iso_a2", ""))
    iso_a3 = props.get("ISO_A3", props.get("iso_a3", ""))
    adm0_a3 = props.get("ADM0_A3", props.get("adm0_a3", ""))
    name = props.get("NAME", props.get("name", "Unknown"))

    # Step 1: valid standard ISO codes
    valid_a2 = iso_a2 and iso_a2 != "-99" and len(iso_a2) == 2
    valid_a3 = iso_a3 and iso_a3 != "-99" and len(iso_a3) == 3

    # Step 2: override lookup from our hard-coded table
    if not valid_a2 or not valid_a3:
        key = adm0_a3 if adm0_a3 and adm0_a3 != "-99" else None
        if key and key in _KNOWN_ISO_OVERRIDES:
            override = _KNOWN_ISO_OVERRIDES[key]
            if not valid_a2:
                iso_a2 = override[0]
                valid_a2 = True
            if not valid_a3:
                iso_a3 = override[1]
                valid_a3 = True

    # Step 3: derive A2 from A3 or vice versa
    if valid_a3 and not valid_a2:
        iso_a2 = iso_a3[:2]
        valid_a2 = True
    if valid_a2 and not valid_a3:
        iso_a3 = adm0_a3 if adm0_a3 and adm0_a3 != "-99" else (iso_a2 + iso_a2[0])
        valid_a3 = True

    # Step 4: last resort — generate synthetic code
    if not valid_a2 or not valid_a3:
        iso_a2, iso_a3 = _generate_synthetic_iso(name, adm0_a3)

    return iso_a2.upper(), iso_a3.upper()


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

    # Track which ISO A2 codes we've used to avoid duplicate key violations
    _used_iso_a2 = set()

    for feature in features:
        props = feature.get("properties", {})
        geometry = feature.get("geometry")

        if not geometry:
            continue

        name = props.get("NAME", props.get("name", "Unknown"))
        adm0_a3 = props.get("ADM0_A3", props.get("adm0_a3", ""))

        if name in ("Unknown", "") or not geometry.get("coordinates"):
            continue

        # Robust ISO resolution — every country gets a code
        iso_a2, iso_a3 = resolve_iso_codes(props)

        # Ensure uniqueness of iso_a2 (used as iso_code primary key)
        if iso_a2 in _used_iso_a2:
            # Append a suffix derived from the name to make it unique
            h = hashlib.md5(name.encode()).hexdigest()[:2].upper()
            iso_a2 = f"X{h[0]}"
            attempt = 0
            while iso_a2 in _used_iso_a2:
                attempt += 1
                iso_a2 = f"X{chr(65 + (attempt % 26))}"
        _used_iso_a2.add(iso_a2)

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
            iso_code=iso_a2,
            iso_a3=iso_a3,
            geometry=json.dumps(geometry),
            population=population,
            area_km2=area_km2,
            capital=capital_name,
            flag_emoji=iso_to_flag(iso_a2),
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


def _name_polygon_parts(geoms_to_process, name, places_lookup):
    """Generate meaningful names for each polygon part of a multi-part region.
    Instead of 'Galway (3)' → 'Galway (Inishmore)' using nearby populated places.
    The largest polygon keeps the bare name; smaller parts get named by nearby places
    or cardinal direction from the mainland."""
    if len(geoms_to_process) <= 1:
        return [name]

    from shapely.geometry import shape as shp, Point as Pt

    # Find the largest polygon (mainland)
    areas = [(calculate_area_km2(g), i) for i, g in enumerate(geoms_to_process)]
    largest_idx = max(areas, key=lambda x: x[0])[1]

    try:
        mainland_shape = shp(geoms_to_process[largest_idx])
        mainland_centroid = mainland_shape.centroid
    except Exception:
        mainland_centroid = None

    names = []
    used_place_names = set()

    for i, geom in enumerate(geoms_to_process):
        if i == largest_idx:
            names.append(name)  # Main body keeps the base name
            continue

        part_name = None

        # Try to find a populated place within this polygon
        if places_lookup:
            try:
                poly = shp(geom)
                best_place = None
                best_pop = -1
                for place in places_lookup:
                    pt = Pt(place["coords"][0], place["coords"][1])
                    if poly.contains(pt) and place["pop"] > best_pop:
                        if place["name"] not in used_place_names:
                            best_place = place["name"]
                            best_pop = place["pop"]
                if best_place:
                    part_name = f"{name} ({best_place})"
                    used_place_names.add(best_place)
            except Exception:
                pass

        # Fallback: use cardinal direction from mainland
        if not part_name and mainland_centroid:
            try:
                poly = shp(geom)
                centroid = poly.centroid
                dx = centroid.x - mainland_centroid.x
                dy = centroid.y - mainland_centroid.y

                dirs = []
                if abs(dy) > 0.05:
                    dirs.append("N" if dy > 0 else "S")
                if abs(dx) > 0.05:
                    dirs.append("E" if dx > 0 else "W")
                direction = "".join(dirs) if dirs else ""

                if direction:
                    part_name = f"{name} ({direction} Isle)"
                else:
                    part_name = f"{name} (Isle {i + 1})"
            except Exception:
                part_name = f"{name} ({i + 1})"

        if not part_name:
            part_name = f"{name} ({i + 1})"

        names.append(part_name)

    return names


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

    # Load populated places for intelligent island/exclave naming
    _places_path = os.path.join(os.path.dirname(geojson_path), "ne_10m_populated_places_simple.geojson")
    _places_lookup = []
    if os.path.exists(_places_path):
        try:
            with open(_places_path, "r", encoding="utf-8") as _pf:
                _places_data = json.load(_pf)
            for _pf_feat in _places_data.get("features", []):
                _pg = _pf_feat.get("geometry", {})
                _pp = _pf_feat.get("properties", {})
                if _pg.get("type") == "Point" and _pg.get("coordinates"):
                    _places_lookup.append({
                        "name": _pp.get("name", ""),
                        "coords": _pg["coordinates"],
                        "pop": _pp.get("pop_max", 0) or 0
                    })
            print(f"  Loaded {len(_places_lookup)} places for island naming")
        except Exception as e:
            print(f"  Warning: Could not load places for naming: {e}")

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

        # Generate meaningful names for multi-part regions (islands, exclaves)
        part_names = _name_polygon_parts(geoms_to_process, name, _places_lookup)

        for i, geom in enumerate(geoms_to_process):
            area_km2 = calculate_area_km2(geom)
            # Skip tiny artifacts unless it's the only one
            if len(geoms_to_process) > 1 and area_km2 < 0.5:
                continue

            part_name = part_names[i] if i < len(part_names) else f"{name} ({i+1})"
            
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
