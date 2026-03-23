"""
CMaps — Interactive Globe World Map Editor
Main FastAPI application entry point.
"""
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database import init_db
from routers import countries, features, cities, projects, stats, flags, regions, capitals


async def _fill_missing_flags_bg():
    """Background task: try to download flags for countries that are still missing them."""
    await asyncio.sleep(5)  # Let the server finish starting up first
    try:
        from database import SessionLocal
        from setup_data import fill_missing_flags
        db = SessionLocal()
        try:
            fill_missing_flags(db)
        finally:
            db.close()
    except Exception as e:
        print(f"  ⚠ Background flag-fill error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    # Initialize database
    init_db()

    DATA_DIR = os.path.join("static", "data")
    countries_50m = os.path.join(DATA_DIR, "ne_50m_admin_0_countries.geojson")
    countries_110m = os.path.join(DATA_DIR, "ne_110m_admin_0_countries.geojson")
    # Prefer 50m (more countries, includes microstates); fallback to 110m
    countries_path = countries_50m if os.path.exists(countries_50m) else countries_110m

    # Check if data is setup
    from setup_data import is_data_ready, setup_data
    if not is_data_ready():
        print("\n  ⚠ Data not found. Running first-time setup...")
        setup_data()
    else:
        # Ensure DB is seeded even if data files exist
        from database import SessionLocal
        from services.data_loader import load_countries, load_regions, load_capitals
        db = SessionLocal()
        try:
            load_countries(db, countries_path)
            regions_path = os.path.join(DATA_DIR, "ne_10m_admin_1_states_provinces.geojson")
            if os.path.exists(regions_path):
                load_regions(db, regions_path)
            cities_path = os.path.join(DATA_DIR, "ne_10m_populated_places_simple.geojson")
            if os.path.exists(cities_path):
                load_capitals(db, cities_path)
        finally:
            db.close()

    # Background: fill flags for any countries that are still missing them
    asyncio.create_task(_fill_missing_flags_bg())

    yield


app = FastAPI(
    title="CMaps",
    description="Interactive Globe World Map Editor for Alternate History",
    version="2.0.0",
    lifespan=lifespan,
)

# GZip compression — huge win for multi-MB GeoJSON responses
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(countries.router)
app.include_router(features.router)
app.include_router(cities.router)
app.include_router(projects.router)
app.include_router(stats.router)
app.include_router(flags.router)
app.include_router(regions.router)
app.include_router(capitals.router)

# Serve static files
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root():
    """Serve the main SPA."""
    return FileResponse(
        os.path.join(STATIC_DIR, "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
    )


@app.get("/sw.js")
async def service_worker():
    """Serve the service worker from root scope for PWA."""
    return FileResponse(
        os.path.join(STATIC_DIR, "sw.js"),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Service-Worker-Allowed": "/"},
    )


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "CMaps", "version": "2.0.0"}
