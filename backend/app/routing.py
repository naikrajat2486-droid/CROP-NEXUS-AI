import httpx

OSRM_BASE = "https://router.project-osrm.org"

async def road_distance_km(start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> float:
    # OSRM expects longitude,latitude coordinate order.
    url = f"{OSRM_BASE}/route/v1/driving/{start_lon},{start_lat};{end_lon},{end_lat}"
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(url, params={"overview": "false", "alternatives": "false"})
            response.raise_for_status()
            payload = response.json()
    except httpx.TimeoutException as exc:
        raise RuntimeError("Road-routing service timed out. Try again later; no distance was estimated.") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError("Road-routing service is unavailable. Check internet access and try again; no distance was estimated.") from exc
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise RuntimeError("No driving route was returned for these coordinates. Check the farm location and try again.")
    return round(payload["routes"][0]["distance"] / 1000.0, 2)
