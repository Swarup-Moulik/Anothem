import os
import uuid
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from supabase import create_client, Client

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/images",
    tags=["Images"]
)

# Initialize Supabase Client (Only needed for storage uploads)
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"), 
    os.getenv("SUPABASE_SERVICE_KEY")
)

@router.get("/", response_model=List[schemas.Image])
def get_images(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    # Return images sorted by newest first
    images = db.query(models.Image).order_by(models.Image.created_at.desc()).offset(skip).limit(limit).all()
    return images

@router.post("/upload", response_model=schemas.Image)
async def upload_image(file: UploadFile = File(...), db: Session = Depends(get_db)):
    # 1. Generate a unique filename to prevent overwrites
    file_ext = file.filename.split(".")[-1]
    file_path = f"{uuid.uuid4()}.{file_ext}"
    
    # 2. Upload the file binary to Supabase Storage bucket 'images'
    try:
        file_content = await file.read()
        supabase.storage.from_("images").upload(
            path=file_path, 
            file=file_content,
            file_options={"content-type": file.content_type}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase Upload Failed: {str(e)}")

    # 3. Get the Public URL so the frontend can display it
    public_url = supabase.storage.from_("images").get_public_url(file_path)

    # 4. Save Metadata to PostgreSQL
    db_image = models.Image(
        filename=file.filename,
        storage_path=file_path,
        public_url=public_url
    )
    db.add(db_image)
    db.commit()
    db.refresh(db_image)

    return db_image

@router.delete("/{image_id}")
def delete_image(image_id: int, db: Session = Depends(get_db)):
    # 1. Find the image in DB
    image = db.query(models.Image).filter(models.Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # 2. Delete from Supabase Storage
    # (The storage path is stored in the DB record)
    try:
        # Supabase-py uses remove() which takes a list of paths
        supabase.storage.from_("images").remove([image.storage_path])
    except Exception as e:
        # Log error but continue to delete from DB so we don't have a zombie record
        print(f"Warning: Failed to delete from storage: {e}")

    # 3. Delete Annotations first (if cascading is not set up in SQL)
    db.query(models.Annotation).filter(models.Annotation.image_id == image_id).delete()

    # 4. Delete Image Record
    db.delete(image)
    db.commit()

    return {"status": "success", "message": "Image deleted"}