from sqlalchemy import String, Float, Integer, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
from .database import Base

class Crop(Base):
    __tablename__ = "crops"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(80), default="General")

class Market(Base):
    __tablename__ = "markets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    district: Mapped[str] = mapped_column(String(100))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)

class MarketPrice(Base):
    __tablename__ = "market_prices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    crop_name: Mapped[str] = mapped_column(String(80), index=True)
    market_id: Mapped[int] = mapped_column(Integer, index=True)
    price_per_quintal: Mapped[float] = mapped_column(Float)
    price_date: Mapped[str] = mapped_column(String(20))
    source_label: Mapped[str] = mapped_column(String(100), default="SAMPLE PRICE")

class MarketObservation(Base):
    __tablename__ = "market_observations"
    __table_args__ = (
        UniqueConstraint("crop_name", "market_name", "district", "observed_date", "source_label"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    crop_name: Mapped[str] = mapped_column(String(80), index=True)
    market_name: Mapped[str] = mapped_column(String(120), index=True)
    district: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(80), default="Karnataka")
    min_price: Mapped[float] = mapped_column(Float)
    max_price: Mapped[float] = mapped_column(Float)
    modal_price: Mapped[float] = mapped_column(Float)
    observed_date: Mapped[str] = mapped_column(String(20), index=True)
    source_label: Mapped[str] = mapped_column(String(120))

class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    farmer_name: Mapped[str] = mapped_column(String(120))
    crop_name: Mapped[str] = mapped_column(String(80))
    quantity_kg: Mapped[float] = mapped_column(Float)
    origin: Mapped[str] = mapped_column(String(160))
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class GPSTrackingSession(Base):
    __tablename__ = "gps_tracking_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.batch_id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="tracking")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class GPSCheckpoint(Base):
    __tablename__ = "gps_checkpoints"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.batch_id"), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("gps_tracking_sessions.id"), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
