from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime

class AnnotationBase(BaseModel):
    # This accepts the raw list of Fabric.js objects
    data: List[Dict[str, Any]] 

class AnnotationCreate(AnnotationBase):
    pass

class Annotation(AnnotationBase):
    id: int
    image_id: int
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True