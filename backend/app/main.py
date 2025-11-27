from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import images, annotations

# 1. Create Database Tables (If they don't exist)
Base.metadata.create_all(bind=engine)

# 2. Initialize App
app = FastAPI(title="Annothem Backend")

# 3. CORS Configuration (Allow React Frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://annothem.onrender.com"], # Adjust if your React port differs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4. Register Routers
app.include_router(images.router)
app.include_router(annotations.router)

@app.get("/")
def root():
    return {"message": "Annothem API is running!"}