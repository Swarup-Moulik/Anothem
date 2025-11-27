from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/annotations",
    tags=["Annotations"]
)

# GET: Load annotations for a specific image
@router.get("/{image_id}", response_model=List[Dict[str, Any]])
def get_annotations(image_id: int, db: Session = Depends(get_db)):
    annotation = db.query(models.Annotation).filter(models.Annotation.image_id == image_id).first()
    
    if not annotation:
        return [] # Return empty list if no work saved yet
    
    return annotation.data # Returns the JSONB data directly

# POST: Save annotations (Create or Update)
@router.post("/{image_id}")
def save_annotations(
    image_id: int, 
    payload: schemas.AnnotationCreate, 
    db: Session = Depends(get_db)
):
    # Check if annotations already exist for this image
    existing = db.query(models.Annotation).filter(models.Annotation.image_id == image_id).first()
    
    if existing:
        # UPDATE existing row
        existing.data = payload.data
    else:
        # CREATE new row
        new_anno = models.Annotation(image_id=image_id, data=payload.data)
        db.add(new_anno)
    
    db.commit()
    return {"status": "success", "message": "Annotations saved"}