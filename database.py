"""
CMaps Database — SQLAlchemy models and engine setup.
Supports SQLite (default) or PostgreSQL via DATABASE_URL env var.
"""
import json
import datetime
import os
from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime, Boolean,
    ForeignKey, create_engine
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/cmaps.db")

# Handle SQLite-specific connect args
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ═══════════════════════════════════════════════════════
#  COUNTRY
# ═══════════════════════════════════════════════════════

class Country(Base):
    __tablename__ = "countries"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False, index=True)
    iso_code = Column(String(10), nullable=True, unique=True)
    iso_a3 = Column(String(10), nullable=True)
    geometry = Column(Text, nullable=False)
    population = Column(Integer, default=0)
    area_km2 = Column(Float, default=0.0)
    capital = Column(String(255), nullable=True)
    flag_emoji = Column(String(10), nullable=True)
    color = Column(String(7), nullable=True)
    continent = Column(String(100), nullable=True)
    subregion = Column(String(100), nullable=True)
    sovereignty = Column(String(255), nullable=True)
    gdp_md = Column(Float, nullable=True)  # GDP in millions USD
    currency = Column(String(100), nullable=True)
    government_type = Column(String(255), nullable=True)
    flag_url = Column(String(500), nullable=True)  # Custom flag image URL
    hdi_index = Column(Float, nullable=True)  # Human Development Index
    literacy_rate = Column(Float, nullable=True)  # Literacy rate %
    custom_fields = Column(Text, nullable=True)  # JSON string of custom typed fields
    is_custom = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow,
                        onupdate=datetime.datetime.utcnow)

    # Relationships
    regions = relationship("Region", back_populates="country",
                           cascade="all, delete-orphan")
    capitals = relationship("Capital", back_populates="country",
                            cascade="all, delete-orphan")

    def to_geojson_feature(self, include_geometry=True):
        """Convert to GeoJSON Feature dict."""
        properties = {
            "id": self.id,
            "name": self.name,
            "iso_code": self.iso_code,
            "iso_a3": self.iso_a3,
            "population": self.population,
            "area_km2": round(self.area_km2, 2) if self.area_km2 else 0,
            "capital": self.capital,
            "flag_emoji": self.flag_emoji,
            "flag_url": self.flag_url,
            "color": self.color,
            "continent": self.continent,
            "subregion": self.subregion,
            "sovereignty": self.sovereignty,
            "gdp_md": self.gdp_md,
            "currency": self.currency,
            "government_type": self.government_type,
            "hdi_index": self.hdi_index,
            "literacy_rate": self.literacy_rate,
            "custom_fields": (json.loads(self.custom_fields)
                              if self.custom_fields and isinstance(self.custom_fields, str)
                              else self.custom_fields),
            "is_custom": self.is_custom,
        }
        feature = {"type": "Feature", "properties": properties}
        if include_geometry:
            feature["geometry"] = (json.loads(self.geometry)
                                   if isinstance(self.geometry, str)
                                   else self.geometry)
        feature["id"] = self.id
        return feature


# ═══════════════════════════════════════════════════════
#  REGION (Admin Level 1: states, departments, provinces)
# ═══════════════════════════════════════════════════════

class Region(Base):
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False, index=True)
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=True,
                        index=True)
    iso_code = Column(String(20), nullable=True)
    iso_country = Column(String(10), nullable=True, index=True)
    geometry = Column(Text, nullable=False)
    area_km2 = Column(Float, default=0.0)
    population = Column(Integer, default=0)
    gdp_md = Column(Float, nullable=True)  # GDP in millions for aggregation
    capital_name = Column(String(255), nullable=True)
    region_type = Column(String(100), nullable=True)  # state/province/dept
    color = Column(String(7), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    country = relationship("Country", back_populates="regions")

    def to_geojson_feature(self, include_geometry=True):
        properties = {
            "id": self.id,
            "name": self.name,
            "country_id": self.country_id,
            "iso_code": self.iso_code,
            "iso_country": self.iso_country,
            "area_km2": round(self.area_km2, 2) if self.area_km2 else 0,
            "population": self.population,
            "capital_name": self.capital_name,
            "region_type": self.region_type,
            "color": self.color,
        }
        feature = {"type": "Feature", "properties": properties}
        if include_geometry:
            feature["geometry"] = (json.loads(self.geometry)
                                   if isinstance(self.geometry, str)
                                   else self.geometry)
        feature["id"] = self.id
        return feature


# ═══════════════════════════════════════════════════════
#  CAPITAL
# ═══════════════════════════════════════════════════════

class Capital(Base):
    __tablename__ = "capitals"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False, index=True)
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=True,
                        index=True)
    country_name = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    population = Column(Integer, default=0)
    is_country_capital = Column(Boolean, default=False, index=True)
    is_regional_capital = Column(Boolean, default=False)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    country = relationship("Country", back_populates="capitals")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "country_id": self.country_id,
            "country_name": self.country_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "population": self.population,
            "is_country_capital": self.is_country_capital,
            "is_regional_capital": self.is_regional_capital,
            "region_id": self.region_id,
        }

    def to_geojson_feature(self):
        return {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [self.longitude, self.latitude],
            },
            "properties": self.to_dict(),
        }


# ═══════════════════════════════════════════════════════
#  PROJECT & EDIT HISTORY
# ═══════════════════════════════════════════════════════

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    snapshot = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow,
                        onupdate=datetime.datetime.utcnow)


class EditHistory(Base):
    __tablename__ = "edit_history"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    action = Column(String(50), nullable=False)
    country_id = Column(Integer, nullable=True)
    before_state = Column(Text, nullable=True)
    after_state = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)


# ═══════════════════════════════════════════════════════
#  INIT / DEPENDENCY
# ═══════════════════════════════════════════════════════

def init_db():
    """Create all tables."""
    os.makedirs("data", exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency for FastAPI routes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
