# CropNexus AI

**Agricultural dashboard, device GPS traceability, market intelligence and QR batches**

CropNexus AI combines SQLite-backed shipment and batch metrics, browser-device GPS checkpoints, Karnataka market observations and QR-coded crop batches.

## Important data notes
- The included crop prices and market records are **sample/demo records** stored in SQLite. They are not live mandi prices.
- Historical trend charts use only dated AGMARKNET observations saved to SQLite. The app does not generate demo trend points.
- Live AGMARKNET retrieval requires a data.gov.in API key. Without it, existing stored rates remain visible; seeded rows are not live prices.
- GPS coordinates come only from the browser Geolocation API. A route returned by OSRM is an estimated road route and is not the recorded GPS trail.
- Road distance is requested from the public OSRM routing service using the farm coordinates entered by the user and the market coordinates stored in the database.
- If routing is unavailable, the API reports an error. It does **not** substitute straight-line distance or invent a road distance.
- This prototype does not authenticate users and is not production-hardened.

## Features
- React + Vite dashboard with Leaflet/OpenStreetMap GPS map and Recharts market trends.
- FastAPI backend and SQLite database (created automatically).
- Timestamped GPS history associated with existing batch IDs.
- Optional data.gov.in AGMARKNET refresh for Karnataka mandi observations.
- Crop and market catalogue with stored prices when no live feed is configured.
- Market comparison: gross value, transport estimate, selling/commission estimate and net return.
- Road distance via OSRM with timeout and explicit failure handling.
- QR batch creation with downloadable PNG QR code.
- Public batch verification endpoint/page.
- API health endpoint.

## Requirements
- Python 3.10+ (Python 3.12 is recommended with the pinned backend dependencies)
- Node.js 18+
- Internet connection for OSRM road routing and initial npm installation.

## Run on Windows (VS Code)

### 1. Open the extracted folder
Open `CropNexus-AI` in VS Code.

### 2. Start the backend
Open Terminal in VS Code:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
# Optional: enable actual Karnataka AGMARKNET observations
$env:DATA_GOV_API_KEY = "your-data.gov.in-api-key"
# Optional: customize the permitted frontend origins for a hosted deployment
# $env:CORS_ORIGINS = "https://your-dashboard.example"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell blocks activation, run this once in that terminal:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```
Then activate the environment again.

Backend API: `http://127.0.0.1:8000`  
Interactive API docs: `http://127.0.0.1:8000/docs`

### 3. Start the frontend
Open a **second** VS Code terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`).
The frontend defaults to the local API at `http://127.0.0.1:8000`. To override it, copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL` to the HTTPS API origin; set backend `CORS_ORIGINS` to the frontend origin.

### GPS on a mobile device
On the same computer, `http://localhost:5173` is a secure context and can request device location. A phone opening the development server by LAN IP over plain HTTP is **not** a secure context, so browsers block geolocation. To track from a phone, serve the frontend and API through HTTPS (for example, a trusted HTTPS reverse proxy/tunnel), configure `VITE_API_BASE_URL` to the reachable HTTPS API and allow the HTTPS frontend origin with `CORS_ORIGINS`. The user must grant location permission; denied or unavailable GPS is shown as an error.

## Dashboard and market intelligence
The Dashboard summarizes the existing batches, stored GPS locations, tracking sessions, market price records and GPS follow-up alerts. Use **Create a traceable batch** to preserve the existing QR workflow.

Market Intelligence shows existing stored rates per quintal. Seeded rows have no verified minimum/maximum, so those fields remain blank. If no historical observations exist, the graph compares stored modal prices across markets rather than inventing a time series. To fetch current data, set `DATA_GOV_API_KEY` in the backend terminal and click **Fetch AGMARKNET**. The app requests Karnataka AGMARKNET records through data.gov.in and stores returned dated observations. A successful API key and network access are required; failures are reported without substituting fabricated values.

The 7-, 30- and 90-day historical charts and percentage changes use only matching dated AGMARKNET observations already stored in the database. Until observations exist, the graph shows a market comparison of stored modal rates; it does not represent historical movement. Net-return recommendations reuse the existing OSRM route and profit calculation.

## Device GPS tracking
Select a registered batch under **GPS Traceability** and press **Start tracking**. The browser requests location permission and saves actual latitude, longitude, accuracy and device timestamp as checkpoints for that batch. Stop tracking to end the saved session; the last checkpoint remains visible. The first saved GPS fix is the recorded farm origin. The dashed OSRM road estimate is separate from the solid GPS-recorded trail.

## QR batch flow
1. Open the Dashboard's **Create a traceable batch** form.
2. Enter farmer name, crop, quantity, origin and optional notes.
3. Create the batch. A unique batch ID and QR image are returned.
4. Download the QR PNG or scan it with a phone.
5. The QR opens the public verification page at `/verify/<batch_id>`.

## API endpoints
- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/crops`
- `GET /api/markets`
- `POST /api/compare`
- `POST /api/batches`
- `GET /api/batches`
- `GET /api/batches/{batch_id}`
- `POST /api/batches/{batch_id}/tracking/start`
- `POST /api/batches/{batch_id}/tracking/{session_id}/locations`
- `POST /api/batches/{batch_id}/tracking/{session_id}/stop`
- `GET /api/batches/{batch_id}/tracking`
- `GET /api/market-intelligence?crop_name=Arecanut&range_days=30`
- `POST /api/market-intelligence/refresh`
- `GET /api/verify/{batch_id}`

## Database and generated files
- SQLite database: `backend/cropnexus.db` (created on first run)
- QR images: `backend/static/qrs/`
- These runtime files are generated locally and are not required in the ZIP.

## Accuracy and limitations
- Demo prices are seeded for demonstration only. Update them with verified market data before making real selling decisions.
- OSRM's public demo service is best-effort and may rate-limit or be unavailable. For a judged demo, test internet connectivity and routing before presenting.
- Transport cost is calculated as `round_trip_road_km × vehicle_cost_per_km × quantity_tonnes` only if the user enters a per-tonne-km rate. In this prototype the field is a **vehicle cost per km**, so the app assumes one vehicle trip for the entered lot. Set the rate to match the vehicle/lot being transported.
- Selling costs are estimated as a percentage of gross value; actual fees vary by market and transaction.
