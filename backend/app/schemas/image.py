from pydantic import BaseModel
from datetime import datetime

# Base class for shared properties
class ImageBase(BaseModel):
    filename: str

# Properties to receive on creation (mostly handled by UploadFile, so this is minimal)
class ImageCreate(ImageBase):
    pass

# Properties to return to the client (The "Response" Model)
class Image(ImageBase):
    id: int
    public_url: str
    created_at: datetime

    # This config tells Pydantic to treat SQLAlchemy models as dictionaries
    class Config:
        from_attributes = True