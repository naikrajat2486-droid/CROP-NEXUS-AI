from pydantic import AwareDatetime, BaseModel, Field
from typing import Optional

class CompareRequest(BaseModel):
    crop_name: str
    quantity_kg: float = Field(gt=0, le=1000000)
    farm_latitude: float = Field(ge=-90, le=90)
    farm_longitude: float = Field(ge=-180, le=180)
    vehicle_cost_per_km: float = Field(ge=0, le=100000)
    selling_cost_percent: float = Field(default=2.0, ge=0, le=100)

class BatchCreate(BaseModel):
    farmer_name: str = Field(min_length=2, max_length=120)
    crop_name: str
    quantity_kg: float = Field(gt=0, le=1000000)
    origin: str = Field(min_length=2, max_length=160)
    notes: Optional[str] = Field(default="", max_length=1000)

class GPSLocationCreate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=100000)
    recorded_at: AwareDatetime

class MarketRefreshRequest(BaseModel):
    crop_name: str = Field(min_length=1, max_length=80)
