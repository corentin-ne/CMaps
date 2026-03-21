"""
CMaps — Interactive Globe World Map Editor
Main FastAPI application entry point.
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import countries, features, cities, projects, regions, capitals


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    # Initialize database
    init_db()

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
            load_countries(db, os.path.join(
                "static", "data", "ne_110m_admin_0_countries.geojson"))
            regions_path = os.path.join(
                "static", "data", "ne_10m_admin_1_states_provinces.geojson")
            if os.path.exists(regions_path):
                load_regions(db, regions_path)
            cities_path = os.path.join(
                "static", "data", "ne_10m_populated_places_simple.geojson")
            if os.path.exists(cities_path):
                load_capitals(db, cities_path)
        finally:
            db.close()

    yield


app = FastAPI(
    title="CMaps",
    description="Interactive Globe World Map Editor for Alternate History",
    version="2.0.0",
    lifespan=lifespan,
)

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
app.include_router(regions.router)
app.include_router(capitals.router)

# Serve static files
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root():
    """Serve the main SPA."""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "CMaps", "version": "2.0.0"}
