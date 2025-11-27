from sqlalchemy import Column, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base

class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    
    # Link this annotation to an specific Image ID
    image_id = Column(Integer, ForeignKey("images.id")) 
    
    # Stores the entire array of rectangles, circles, etc.
    data = Column(JSONB) 
    
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())