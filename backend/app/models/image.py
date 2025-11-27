from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.database import Base

class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    storage_path = Column(String) # Path inside the Supabase bucket (e.g. "abc-123.jpg")
    public_url = Column(String)   # The link to show it in React
    created_at = Column(DateTime(timezone=True), server_default=func.now())