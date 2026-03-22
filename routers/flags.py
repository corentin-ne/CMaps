"""
CMaps Flags Router — Custom flag image upload and management.
"""
import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session

from database import get_db, Country

router = APIRouter(prefix="/api/flags", tags=["flags"])

FLAGS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "data", "flags")


@router.post("/fill-missing")
def fill_missing_flags_endpoint(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger a background download of flags for countries that are still missing them."""
    def _run(db_session: Session):
        try:
            from setup_data import fill_missing_flags
            filled = fill_missing_flags(db_session)
            print(f"  fill-missing-flags: {filled} updated")
        except Exception as e:
            print(f"  fill-missing-flags error: {e}")

    background_tasks.add_task(_run, db)
    return {"status": "started", "message": "Flag fill running in background"}


@router.post("/{country_id}")
async def upload_flag(
    country_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a custom flag image (PNG/SVG) for a country."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")

    # Validate file type
    valid_types = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
    if file.content_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Accepted: PNG, SVG, JPEG, WebP"
        )

    # Ensure flags directory exists
    os.makedirs(FLAGS_DIR, exist_ok=True)

    # Generate unique filename
    ext = os.path.splitext(file.filename)[1] or '.png'
    filename = f"flag_{country_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(FLAGS_DIR, filename)

    # Save file
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)

    # Update country record
    flag_url = f"/static/data/flags/{filename}"
    country.flag_url = flag_url
    db.commit()

    return {"flag_url": flag_url, "filename": filename}


@router.get("/{country_id}")
def get_flag(country_id: int, db: Session = Depends(get_db)):
    """Get the flag URL for a country."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")
    return {
        "flag_emoji": country.flag_emoji,
        "flag_url": getattr(country, 'flag_url', None),
    }


@router.delete("/{country_id}")
def delete_flag(country_id: int, db: Session = Depends(get_db)):
    """Remove a custom flag and revert to emoji."""
    country = db.query(Country).filter(Country.id == country_id).first()
    if not country:
        raise HTTPException(status_code=404, detail="Country not found")

    flag_url = getattr(country, 'flag_url', None)
    if flag_url:
        filepath = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            flag_url.lstrip('/')
        )
        if os.path.exists(filepath):
            os.remove(filepath)
        country.flag_url = None
        db.commit()

    return {"status": "flag removed"}
