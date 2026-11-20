from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from pathlib import Path
from datetime import date, datetime, timezone, timedelta
from uuid import uuid4
import os
import math
import qrcode
import httpx

from .database import Base, engine, get_db, SessionLocal
from .models import Crop, Market, MarketPrice, MarketObservation, Batch, GPSTrackingSession, GPSCheckpoint
from .schemas import CompareRequest, BatchCreate, GPSLocationCreate, MarketRefreshRequest
from .routing import road_distance_km

BASE_DIR = Path(__file__).resolve().parent.parent
QR_DIR = BASE_DIR / "static" / "qrs"
QR_DIR.mkdir(parents=True, exist_ok=True)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="CropNexus AI API", version="1.0.0",
              description="Market intelligence and QR traceability. Live price observations are optional.")
cors_origins = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=cors_origins,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

def seed_data():
    db = SessionLocal()
    try:
        if db.scalar(select(Crop.id).limit(1)) is not None:
            return
        crops = [Crop(name=n, category=c) for n, c in [
            ("Arecanut", "Plantation"), ("Paddy", "Cereal"), ("Maize", "Cereal"),
            ("Coconut", "Plantation"), ("Turmeric", "Spice"), ("Black Pepper", "Spice")
        ]]
        markets = [
            Market(name="Sirsi APMC", district="Uttara Kannada", latitude=14.6200, longitude=74.8350),
            Market(name="Yellapur APMC", district="Uttara Kannada", latitude=14.9630, longitude=74.7090),
            Market(name="Siddapur Market", district="Uttara Kannada", latitude=14.3430, longitude=74.8940),
            Market(name="Kumta APMC", district="Uttara Kannada", latitude=14.4250, longitude=74.4180),
            Market(name="Shivamogga APMC", district="Shivamogga", latitude=13.9299, longitude=75.5681),
        ]
        db.add_all(crops + markets)
        db.flush()
        demo_prices = {
            "Arecanut": [52000, 50500, 51500, 49800, 51000],
            "Paddy": [2450, 2380, 2500, 2420, 2480],
            "Maize": [2250, 2320, 2200, 2280, 2350],
            "Coconut": [2800, 2750, 2900, 2700, 2850],
            "Turmeric": [12500, 12800, 12200, 13000, 12600],
            "Black Pepper": [62000, 61000, 63500, 60000, 62500],
        }
        for crop, values in demo_prices.items():
            for market, price in zip(markets, values):
                db.add(MarketPrice(crop_name=crop, market_id=market.id, price_per_quintal=price,
                                   price_date=date.today().isoformat(), source_label="SAMPLE PRICE — NOT LIVE"))
        db.commit()
    finally:
        db.close()

seed_data()

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "CropNexus AI API", "price_data": "Live feed unavailable"}

@app.get("/api/crops")
def list_crops(db: Session = Depends(get_db)):
    return [{"name": c.name, "category": c.category} for c in db.scalars(select(Crop).order_by(Crop.name)).all()]

@app.get("/api/markets")
def list_markets(db: Session = Depends(get_db)):
    return [{"id": m.id, "name": m.name, "district": m.district, "latitude": m.latitude, "longitude": m.longitude}
            for m in db.scalars(select(Market).order_by(Market.name)).all()]

@app.post("/api/compare")
async def compare_markets(payload: CompareRequest, db: Session = Depends(get_db)):
    rows = db.execute(select(Market, MarketPrice).join(MarketPrice, MarketPrice.market_id == Market.id)
                      .where(MarketPrice.crop_name == payload.crop_name)).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No price records found for this crop.")
    observations = db.scalars(select(MarketObservation).where(
        func.lower(MarketObservation.crop_name) == payload.crop_name.lower()
    ).order_by(MarketObservation.id.desc())).all()
    observed_prices = {
        (item.market_name.strip().casefold(), item.district.strip().casefold()): item
        for item in _latest_observations(observations)
    }
    results = []
    route_errors = []
    for market, price in rows:
        observation = observed_prices.get((market.name.strip().casefold(), market.district.strip().casefold()))
        price_per_quintal = observation.modal_price if observation else price.price_per_quintal
        price_date = observation.observed_date if observation else price.price_date
        price_source = observation.source_label if observation else price.source_label
        try:
            one_way_km = await road_distance_km(payload.farm_latitude, payload.farm_longitude,
                                                market.latitude, market.longitude)
        except RuntimeError as exc:
            route_errors.append({"market": market.name, "error": str(exc)})
            continue
        quantity_quintals = payload.quantity_kg / 100.0
        gross = quantity_quintals * price_per_quintal
        transport = one_way_km * 2 * payload.vehicle_cost_per_km
        selling = gross * payload.selling_cost_percent / 100.0
        net = gross - transport - selling
        results.append({
            "market_id": market.id, "market_name": market.name, "district": market.district,
            "price_per_quintal": price_per_quintal, "price_date": price_date,
            "price_source": price_source, "one_way_road_km": one_way_km,
            "round_trip_road_km": round(one_way_km * 2, 2), "gross_value": round(gross, 2),
            "transport_cost": round(transport, 2), "selling_cost": round(selling, 2),
            "estimated_net_return": round(net, 2)
        })
    results.sort(key=lambda x: x["estimated_net_return"], reverse=True)
    if not results:
        raise HTTPException(status_code=503, detail={
            "message": "No market could be compared because road routing failed. No distances or profits were fabricated.",
            "route_errors": route_errors
        })
    price_notice = (
        "Market price sources are listed per result; estimates use available stored modal prices."
        if any(result["price_source"] == "data.gov.in AGMARKNET" for result in results)
        else "SAMPLE PRICES ARE NOT LIVE"
    )
    return {"crop_name": payload.crop_name, "quantity_kg": payload.quantity_kg,
            "price_data_notice": price_notice,
            "results": results, "markets_skipped": route_errors}

@app.post("/api/batches")
def create_batch(payload: BatchCreate, db: Session = Depends(get_db)):
    batch_id = "CNX-" + uuid4().hex[:10].upper()
    record = Batch(batch_id=batch_id, farmer_name=payload.farmer_name.strip(),
                   crop_name=payload.crop_name, quantity_kg=payload.quantity_kg,
                   origin=payload.origin.strip(), notes=(payload.notes or "").strip())
    db.add(record)
    db.commit()
    db.refresh(record)
    # QR contains the frontend verification URL; configurable for local demo.
    verify_url = f"http://localhost:5173/verify/{batch_id}"
    img = qrcode.make(verify_url)
    filename = f"{batch_id}.png"
    img.save(QR_DIR / filename)
    return {"batch_id": batch_id, "verification_url": verify_url,
            "qr_image_url": f"/static/qrs/{filename}", "message": "Batch created. Scan the QR to verify."}

@app.get("/api/batches/{batch_id}")
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    record = db.scalar(select(Batch).where(Batch.batch_id == batch_id.upper()))
    if not record:
        raise HTTPException(status_code=404, detail="Batch not found.")
    return {"batch_id": record.batch_id, "farmer_name": record.farmer_name,
            "crop_name": record.crop_name, "quantity_kg": record.quantity_kg,
            "origin": record.origin, "notes": record.notes,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "verification_status": "RECORDED IN CROPNEXUS DATABASE"}

def _iso(value):
    if value is None:
        return None
    return value.isoformat() + ("Z" if value.tzinfo is None else "")

def _market_date(value: str):
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            pass
    return None

@app.get("/api/batches")
def list_batches(db: Session = Depends(get_db)):
    records = db.scalars(select(Batch).order_by(Batch.created_at.desc())).all()
    return [{
        "batch_id": item.batch_id, "crop_name": item.crop_name, "quantity_kg": item.quantity_kg,
        "farmer_name": item.farmer_name, "origin": item.origin, "created_at": _iso(item.created_at)
    } for item in records]

@app.get("/api/dashboard")
def dashboard_summary(db: Session = Depends(get_db)):
    batches = db.scalars(select(Batch).order_by(Batch.created_at.desc())).all()
    active_sessions = db.scalars(select(GPSTrackingSession).where(
        GPSTrackingSession.status == "tracking")).all()
    checkpoint_batches = set(db.scalars(select(GPSCheckpoint.batch_id).distinct()).all())
    recent = db.execute(
        select(GPSCheckpoint, Batch)
        .join(Batch, Batch.batch_id == GPSCheckpoint.batch_id)
        .order_by(GPSCheckpoint.id.desc()).limit(6)
    ).all()
    active_batch_ids = {session.batch_id for session in active_sessions}
    alerts = []
    for batch in batches:
        if batch.batch_id not in checkpoint_batches:
            alerts.append({"batch_id": batch.batch_id, "message": "No GPS checkpoints recorded"})
        elif batch.batch_id not in active_batch_ids:
            alerts.append({"batch_id": batch.batch_id, "message": "Tracking is stopped; last position is retained"})
    tracked = len(checkpoint_batches)
    live_rows = db.scalars(select(MarketObservation).order_by(MarketObservation.id.desc())).all()
    latest_by_key = {}
    for item in live_rows:
        key = (item.crop_name.casefold(), item.market_name.casefold(), item.district.casefold())
        current = latest_by_key.get(key)
        if current is None or (_market_date(item.observed_date) or date.min) > \
                (_market_date(current.observed_date) or date.min):
            latest_by_key[key] = item
    latest_live_prices = sorted(latest_by_key.values(), key=lambda item: item.id, reverse=True)[:6]
    prices = db.execute(
        select(MarketPrice, Market).join(Market, Market.id == MarketPrice.market_id)
        .order_by(MarketPrice.price_date.desc()).limit(6)
    ).all() if not latest_live_prices else []
    return {
        "active_shipments": len(active_batch_ids),
        "total_batches": len(batches),
        "active_gps_sessions": len(active_batch_ids),
        "tracked_batches": tracked,
        "traceability_percent": round(tracked * 100 / len(batches), 1) if batches else 0,
        "gps_status": "Live tracking active" if active_batch_ids else "No active GPS sessions",
        "recent_activity": [{
            "batch_id": batch.batch_id, "crop_name": batch.crop_name,
            "latitude": point.latitude, "longitude": point.longitude,
            "accuracy_m": point.accuracy_m, "recorded_at": _iso(point.recorded_at)
        } for point, batch in recent],
        "alerts": alerts[:8],
        "market_prices": ([{
            "crop_name": item.crop_name, "market_name": item.market_name, "district": item.district,
            "price_per_quintal": item.modal_price, "price_date": item.observed_date,
            "source": item.source_label
        } for item in latest_live_prices] if latest_live_prices else [{
            "crop_name": price.crop_name, "market_name": market.name, "district": market.district,
            "price_per_quintal": price.price_per_quintal, "price_date": price.price_date,
            "source": price.source_label
        } for price, market in prices])
    }

@app.post("/api/batches/{batch_id}/tracking/start")
def start_tracking(batch_id: str, db: Session = Depends(get_db)):
    batch = db.scalar(select(Batch).where(Batch.batch_id == batch_id.upper()))
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    session = GPSTrackingSession(batch_id=batch.batch_id, status="tracking")
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session_id": session.id, "batch_id": batch.batch_id, "status": session.status,
            "started_at": _iso(session.started_at)}

@app.post("/api/batches/{batch_id}/tracking/{session_id}/locations")
def record_gps_location(batch_id: str, session_id: int, payload: GPSLocationCreate,
                         db: Session = Depends(get_db)):
    session = db.scalar(select(GPSTrackingSession).where(
        GPSTrackingSession.id == session_id,
        GPSTrackingSession.batch_id == batch_id.upper()))
    if not session:
        raise HTTPException(status_code=404, detail="Tracking session not found for this batch.")
    if session.status != "tracking":
        raise HTTPException(status_code=409, detail="Tracking session is stopped.")
    point = GPSCheckpoint(
        batch_id=session.batch_id, session_id=session.id,
        latitude=payload.latitude, longitude=payload.longitude,
        accuracy_m=payload.accuracy_m, recorded_at=payload.recorded_at
    )
    db.add(point)
    db.commit()
    db.refresh(point)
    return {"id": point.id, "batch_id": point.batch_id, "latitude": point.latitude,
            "longitude": point.longitude, "accuracy_m": point.accuracy_m,
            "recorded_at": _iso(point.recorded_at)}

@app.post("/api/batches/{batch_id}/tracking/{session_id}/stop")
def stop_tracking(batch_id: str, session_id: int, db: Session = Depends(get_db)):
    session = db.scalar(select(GPSTrackingSession).where(
        GPSTrackingSession.id == session_id,
        GPSTrackingSession.batch_id == batch_id.upper()))
    if not session:
        raise HTTPException(status_code=404, detail="Tracking session not found for this batch.")
    if session.status == "tracking":
        session.status = "stopped"
        session.stopped_at = datetime.now(timezone.utc)
        db.commit()
    return {"session_id": session.id, "batch_id": session.batch_id, "status": session.status,
            "stopped_at": _iso(session.stopped_at)}

@app.get("/api/batches/{batch_id}/tracking")
def get_tracking(batch_id: str, db: Session = Depends(get_db)):
    batch = db.scalar(select(Batch).where(Batch.batch_id == batch_id.upper()))
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    session = db.scalar(select(GPSTrackingSession).where(
        GPSTrackingSession.batch_id == batch.batch_id
    ).order_by(GPSTrackingSession.id.desc()))
    points = db.scalars(select(GPSCheckpoint).where(
        GPSCheckpoint.batch_id == batch.batch_id
    ).order_by(GPSCheckpoint.id.asc())).all()
    return {
        "batch_id": batch.batch_id,
        "status": session.status if session else "not_started",
        "session_id": session.id if session else None,
        "started_at": _iso(session.started_at) if session else None,
        "stopped_at": _iso(session.stopped_at) if session else None,
        "latest": ({
            "session_id": points[-1].session_id,
            "latitude": points[-1].latitude, "longitude": points[-1].longitude,
            "accuracy_m": points[-1].accuracy_m, "recorded_at": _iso(points[-1].recorded_at)
        } if points else None),
        "checkpoints": [{
            "session_id": point.session_id,
            "latitude": point.latitude, "longitude": point.longitude,
            "accuracy_m": point.accuracy_m, "recorded_at": _iso(point.recorded_at)
        } for point in points]
    }

def _latest_observations(records):
    latest = {}
    for item in records:
        key = (item.market_name, item.district)
        if key not in latest:
            latest[key] = item
        elif (_market_date(item.observed_date) or date.min) > \
                (_market_date(latest[key].observed_date) or date.min):
            latest[key] = item
    return sorted(latest.values(), key=lambda item: (item.market_name, item.district))

@app.get("/api/market-intelligence")
def market_intelligence(crop_name: str, range_days: int = 30, db: Session = Depends(get_db)):
    if range_days not in (7, 30, 90):
        raise HTTPException(status_code=422, detail="range_days must be 7, 30, or 90.")
    live_records = db.scalars(select(MarketObservation).where(
        func.lower(MarketObservation.crop_name) == crop_name.lower()
    ).order_by(MarketObservation.id.desc())).all()
    trend_start = date.today() - timedelta(days=range_days - 1)
    trend = []
    for item in live_records:
        observed = _market_date(item.observed_date)
        if observed and trend_start <= observed <= date.today():
            trend.append({
                "market_name": item.market_name, "district": item.district,
                "date": item.observed_date, "min_price": item.min_price,
                "max_price": item.max_price, "modal_price": item.modal_price,
                "source": item.source_label
            })
    if live_records:
        prices = [{
            "market_name": item.market_name, "district": item.district,
            "min_price": item.min_price, "max_price": item.max_price,
            "modal_price": item.modal_price, "price_per_quintal": item.modal_price,
            "price_date": item.observed_date, "source": item.source_label
        } for item in _latest_observations(live_records)]
        price_source = "data.gov.in AGMARKNET"
    else:
        rows = db.execute(
            select(MarketPrice, Market)
            .join(Market, Market.id == MarketPrice.market_id)
            .where(func.lower(MarketPrice.crop_name) == crop_name.lower())
            .order_by(Market.name)
        ).all()
        prices = [{
            "market_name": market.name, "district": market.district,
            "min_price": None, "max_price": None,
            "modal_price": price.price_per_quintal,
            "price_per_quintal": price.price_per_quintal,
            "price_date": price.price_date, "source": price.source_label
        } for price, market in rows]
        price_source = "SAMPLE PRICE — NOT LIVE"
    return {
        "crop_name": crop_name, "state": "Karnataka", "range_days": range_days,
        "prices": prices, "trend": trend, "trend_observations": len(trend),
        "trend_notice": None if trend else "No genuine stored price observations are available for this period.",
        "source": price_source
    }

@app.post("/api/market-intelligence/refresh")
async def refresh_market_intelligence(payload: MarketRefreshRequest, db: Session = Depends(get_db)):
    api_key = os.getenv("DATA_GOV_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail=(
            "DATA_GOV_API_KEY is not configured. Set it in the backend environment to fetch live Karnataka AGMARKNET prices."
        ))
    resource_id = os.getenv("DATA_GOV_RESOURCE_ID", "9ef84268-d588-465a-a308-a864a43d0070")
    url = f"https://api.data.gov.in/resource/{resource_id}"
    params = {
        "api-key": api_key, "format": "json", "limit": 100,
        "filters[state]": "Karnataka", "filters[commodity]": payload.crop_name
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="data.gov.in market data request failed.") from exc
    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list):
        raise HTTPException(status_code=502, detail="data.gov.in returned an unexpected response.")
    saved = 0
    for record in records:
        if not isinstance(record, dict) or str(record.get("state", "")).casefold() != "karnataka":
            continue
        if str(record.get("commodity", "")).strip().casefold() != payload.crop_name.casefold():
            continue
        try:
            market_name = str(record["market"]).strip()
            district = str(record["district"]).strip()
            observed_date = str(record["arrival_date"]).strip()
            minimum = float(record["min_price"])
            maximum = float(record["max_price"])
            modal = float(record["modal_price"])
        except (KeyError, TypeError, ValueError):
            continue
        if (not market_name or not district or not _market_date(observed_date)
                or not all(math.isfinite(value) for value in (minimum, maximum, modal))
                or min(minimum, maximum, modal) < 0
                or minimum > maximum or not minimum <= modal <= maximum):
            continue
        item = db.scalar(select(MarketObservation).where(
            func.lower(MarketObservation.crop_name) == payload.crop_name.lower(),
            func.lower(MarketObservation.market_name) == market_name.lower(),
            func.lower(MarketObservation.district) == district.lower(),
            MarketObservation.observed_date == observed_date,
            MarketObservation.source_label == "data.gov.in AGMARKNET"
        ))
        if item is None:
            item = MarketObservation(
                crop_name=payload.crop_name, market_name=market_name, district=district,
                state="Karnataka", observed_date=observed_date,
                source_label="data.gov.in AGMARKNET",
                min_price=minimum, max_price=maximum, modal_price=modal
            )
            db.add(item)
        else:
            item.min_price, item.max_price, item.modal_price = minimum, maximum, modal
        saved += 1
    db.commit()
    return {"crop_name": payload.crop_name, "source": "data.gov.in AGMARKNET",
            "observations_saved": saved, "message": "Verified market observations stored."}

@app.get("/api/verify/{batch_id}")
def verify_batch(batch_id: str, db: Session = Depends(get_db)):
    return get_batch(batch_id, db)
