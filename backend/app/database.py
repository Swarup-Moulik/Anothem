from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool  # Import NullPool
import os
from dotenv import load_dotenv

# 1. Load .env
load_dotenv()

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# 2. Create Engine with Robust Settings
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    # FIX 1: Check if connection is alive before using it
    pool_pre_ping=True, 
    # FIX 2: Disable client-side pooling (Let Supabase handle it via port 6543)
    poolclass=NullPool,
    # FIX 3: Force SSL (Required by Supabase)
    connect_args={"sslmode": "require"}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()