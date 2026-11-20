from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("CROPNEXUS_DATABASE_URL", f"sqlite:///{(BASE_DIR / 'cropnexus.db').as_posix()}")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
