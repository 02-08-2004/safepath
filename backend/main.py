# ── SafePath FastAPI Backend ──────────────────────────────────────────────────
from email.mime import message
import os, logging, json
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional
from xmlrpc import client
import time
import hashlib

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# FIX: Use psycopg2 which is more stable on Render/Railway
import psycopg2
from psycopg2.extras import RealDictCursor

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
log = logging.getLogger("safepath")

DB_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/safepath"
)

# Geocode cache
geocode_cache = {}


def get_cache_key(query):
    return hashlib.md5(query.lower().strip().encode()).hexdigest()


# Find this section in your main.py (around line 20-30)
def get_db():
    return None


db = None


def dict_row(cursor, row):
    """Convert row to dictionary"""
    return {col.name: row[i] for i, col in enumerate(cursor.description)}


def start_scheduler():
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        scheduler = BackgroundScheduler()
        scheduler.add_job(sync_crime_data, "interval", hours=1, id="crime_sync")
        scheduler.start()
        log.info("Crime data scheduler started (every 1 h)")
    except ImportError:
        log.warning("APScheduler not installed — skipping scheduled sync")


def sync_crime_data():
    api_key = os.getenv("DATA_GOV_API_KEY", "")
    if not api_key or not db:
        return
    try:
        import requests

        r = requests.get(
            "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070",
            params={"api-key": api_key, "format": "json", "limit": 200},
            timeout=15,
        )
        for record in r.json().get("records", []):
            try:
                cur = db.cursor()
                cur.execute(
                    "INSERT INTO incidents (type, description, source, geom) VALUES (%s, %s, 'data_gov_in', ST_SetSRID(ST_Point(%s, %s), 4326))",
                    (
                        record.get("crime_type", "unknown"),
                        record.get("description", ""),
                        float(record["longitude"]),
                        float(record["latitude"]),
                    ),
                )
                db.commit()
            except Exception:
                db.rollback()
        log.info("Crime sync complete")
    except Exception as e:
        log.error(f"Crime sync failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    try:
        from route_engine import prewarm_all

        prewarm_all()
        log.info("AP city graphs pre-warming in background...")
    except Exception as e:
        log.warning(f"Pre-warm failed: {e}")
    yield
    if db:
        db.close()


app = FastAPI(title="SafePath API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

connected_clients: dict[str, WebSocket] = {}


@app.websocket("/ws/location")
async def location_stream(ws: WebSocket):
    await ws.accept()
    user_id = "anonymous"
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            user_id = data.get("user_id", "anonymous")
            lat = float(data["lat"])
            lng = float(data["lng"])
            connected_clients[user_id] = ws
            if db:
                try:
                    cur = db.cursor()
                    cur.execute(
                        "INSERT INTO gps_tracks (user_id, geom) VALUES (%s, ST_SetSRID(ST_Point(%s, %s), 4326))",
                        (user_id, lng, lat),
                    )
                    db.commit()
                except Exception as e:
                    log.error(f"GPS insert error: {e}")
                    db.rollback()
            await ws.send_json({"status": "saved", "ts": data.get("ts")})
    except WebSocketDisconnect:
        connected_clients.pop(user_id, None)
        log.info(f"Client {user_id} disconnected")


@app.get("/incidents")
def get_incidents(lat: float, lng: float, radius: int = 500):
    if not db:
        return _mock_incidents(lat, lng)
    try:
        cur = db.cursor()
        cur.execute(
            """SELECT id, type, description, severity,
                   ST_Y(geom) AS lat, ST_X(geom) AS lng, reported_at
            FROM incidents
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography, %s)
            AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY reported_at DESC LIMIT 20""",
            (lng, lat, radius),
        )
        rows = cur.fetchall()
        # Convert to dict format
        return [dict(zip([col[0] for col in cur.description], row)) for row in rows]
    except Exception as e:
        log.error(f"Incidents query error: {e}")
        return _mock_incidents(lat, lng)


def _mock_incidents(lat, lng):
    return [
        {
            "id": 1,
            "type": "poor_lighting",
            "description": "NH-65 underpass — reported 2h ago",
            "lat": lat + 0.003,
            "lng": lng - 0.002,
            "severity": 3,
        },
        {
            "id": 2,
            "type": "theft",
            "description": "Market Rd — reported 6h ago",
            "lat": lat - 0.002,
            "lng": lng + 0.003,
            "severity": 2,
        },
        {
            "id": 3,
            "type": "patrol",
            "description": "Active patrol near hospital zone",
            "lat": lat + 0.001,
            "lng": lng + 0.001,
            "severity": 1,
        },
        {
            "id": 4,
            "type": "crowd",
            "description": "Bus stand — safe and busy",
            "lat": lat - 0.001,
            "lng": lng - 0.001,
            "severity": 1,
        },
    ]


@app.get("/route/safe")
def safe_route(olat: float, olng: float, dlat: float, dlng: float):
    routes = None
    try:
        from route_engine import get_safe_routes

        routes = get_safe_routes(olat, olng, dlat, dlng, db_conn=db)
        if routes:
            log.info(f"Real routes returned: {len(routes)}")
        else:
            log.warning("Route engine returned None — using mock")
    except Exception as e:
        log.error(f"Route engine exception: {e}", exc_info=True)
        routes = None

    if not routes:
        routes = _mock_routes(olat, olng, dlat, dlng)

    return {"routes": routes, "generated_at": datetime.utcnow().isoformat()}


def _mock_routes(olat, olng, dlat, dlng):
    import math

    def interp(variant):
        steps = 12
        offsets = {
            "safe": (0.004, -0.003),
            "balanced": (0.002, 0.002),
            "fast": (-0.001, 0.001),
        }
        lo, lo2 = offsets.get(variant, (0, 0))
        return [
            [
                olat + (dlat - olat) * (i / steps) + lo * math.sin(math.pi * i / steps),
                olng
                + (dlng - olng) * (i / steps)
                + lo2 * math.sin(math.pi * i / steps),
            ]
            for i in range(steps + 1)
        ]

    return [
        {
            "id": "safe",
            "name": "Safest Route",
            "coords": interp("safe"),
            "safetyScore": 92,
            "durationMin": 18,
            "distanceKm": 3.2,
            "highlights": ["Well-lit streets", "High foot traffic"],
        },
        {
            "id": "balanced",
            "name": "Balanced Route",
            "coords": interp("balanced"),
            "safetyScore": 74,
            "durationMin": 13,
            "distanceKm": 2.4,
            "highlights": ["Partially lit", "Moderate activity"],
        },
        {
            "id": "fast",
            "name": "Fastest Route",
            "coords": interp("fast"),
            "safetyScore": 41,
            "durationMin": 9,
            "distanceKm": 1.8,
            "highlights": ["Poor lighting", "Isolated stretch"],
        },
    ]


class FeedbackBody(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    rating: int
    tags: list[str] = []
    ts: Optional[int] = None


@app.post("/feedback")
def submit_feedback(body: FeedbackBody):
    if not db:
        return {"status": "saved (mock)"}
    try:
        cur = db.cursor()
        cur.execute(
            "INSERT INTO feedback (rating, tags, geom) VALUES (%s, %s, ST_SetSRID(ST_Point(%s, %s), 4326))",
            (body.rating, body.tags, body.lng or 0, body.lat or 0),
        )
        db.commit()
        return {"status": "saved"}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))


class SOSBody(BaseModel):
    lat: float
    lng: float
    user_name: str = "SafePath User"


@app.post("/sos")
def send_sos(body: SOSBody):
    maps_link = f"https://maps.google.com/?q={body.lat},{body.lng}"
    time_str = datetime.utcnow().strftime("%I:%M %p UTC")
    message = f"EMERGENCY ALERT! {body.user_name} needs help! Location: {maps_link} Time: {time_str} -SafePath"

    sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    token = os.getenv("TWILIO_AUTH_TOKEN", "")
    from_ = os.getenv("TWILIO_FROM_NUMBER", "")
    to = os.getenv("EMERGENCY_CONTACT", "")

    if sid and token and from_ and to:
        try:
            from twilio.rest import Client

            client = Client(sid, token)
            msg = client.messages.create(body=message, from_=from_, to=to)
            log.info(f"SOS SMS sent to {to} — SID: {msg.sid}")
            return {"status": "sms_sent", "to": to, "sid": msg.sid}
        except Exception as e:
            log.error(f"SMS error: {e}")
            return {"status": "failed", "error": str(e)}
    return {"status": "config_missing"}


@app.get("/geocode")
def geocode(q: str):
    import requests

    # Fast cache check
    cache_key = get_cache_key(q)
    if cache_key in geocode_cache:
        cache_time, cached = geocode_cache[cache_key]
        if time.time() - cache_time < 86400:  # 24 hour cache
            log.info(f"Geocode cache hit for: {q}")
            return cached

    results = []
    seen = set()

    # Add small delay to respect Nominatim rate limits
    time.sleep(0.2)

    # Build search query - try with full context first
    search_queries = [
        f"{q}, Amaravati, Andhra Pradesh, India",
        f"{q}, Andhra Pradesh, India",
        f"{q}, India",
        q,
    ]

    for search_query in search_queries:
        if len(results) >= 8:
            break
        try:
            response = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": search_query,
                    "format": "json",
                    "limit": 10,
                    "addressdetails": 1,
                    "namedetails": 1,
                    "countrycodes": "in",
                    "accept-language": "en",
                    "dedupe": 1,
                },
                headers={
                    "User-Agent": "SafePath/1.0 (https://safepath.app; support@safepath.app)",
                    "Accept-Language": "en",
                },
                timeout=8,
            )

            if response.status_code != 200:
                continue

            data = response.json()
            if not data:
                continue

            for place in data:
                lat = float(place["lat"])
                lng = float(place["lon"])
                key = f"{lat:.5f},{lng:.5f}"
                if key in seen:
                    continue
                seen.add(key)

                # Get address components
                address = place.get("address", {})
                name = place.get("name", "")

                # Try to get the best display name
                if not name:
                    name = (
                        address.get("village")
                        or address.get("town")
                        or address.get("city")
                        or address.get("suburb")
                        or q
                    )

                # Build location hierarchy
                location_parts = []

                # Add village/town/city
                if address.get("village"):
                    location_parts.append(address["village"])
                if address.get("town"):
                    location_parts.append(address["town"])
                if address.get("city"):
                    location_parts.append(address["city"])
                if address.get("suburb"):
                    location_parts.append(address["suburb"])

                # Add district
                if address.get("state_district"):
                    location_parts.append(address["state_district"])

                # Add state
                if address.get("state"):
                    location_parts.append(address["state"])

                # Remove duplicates while preserving order
                location_parts = list(dict.fromkeys(location_parts))

                # Create display label
                label = name
                second_text = ""

                if location_parts:
                    if name.lower() != location_parts[0].lower():
                        label = f"{name}, {location_parts[0]}"
                    second_text = (
                        ", ".join(location_parts[1:4])
                        if len(location_parts) > 1
                        else location_parts[0]
                    )

                # Also include the full display name from Nominatim as fallback
                display_name = place.get("display_name", "")

                results.append(
                    {
                        "label": label[:100],
                        "mainText": name[:50] if name else q[:50],
                        "secondText": (
                            second_text[:80]
                            if second_text
                            else (
                                display_name.split(",")[-3] if display_name else "India"
                            )
                        ),
                        "lat": lat,
                        "lng": lng,
                        "fullAddress": display_name[:150],  # For debugging
                    }
                )

        except requests.exceptions.Timeout:
            log.warning(f"Geocode timeout for: {search_query}")
            continue
        except requests.exceptions.ConnectionError:
            log.warning(f"Geocode connection error for: {search_query}")
            continue
        except Exception as e:
            log.warning(f"Geocode error for {search_query}: {e}")
            continue

    # Sort results by relevance
    def calculate_relevance(result):
        lat, lng = result["lat"], result["lng"]
        # Prefer results in Andhra Pradesh region
        in_ap = 12.5 <= lat <= 19.5 and 76.5 <= lng <= 84.5
        # Distance from Amaravati
        dist_from_amaravati = (lat - 16.5062) ** 2 + (lng - 80.6480) ** 2
        # Text match score
        text_score = 0
        q_lower = q.lower()
        result_text = result["mainText"].lower()

        if result_text == q_lower:
            text_score = -30
        elif result_text.startswith(q_lower):
            text_score = -20
        elif q_lower in result_text:
            text_score = -10
        elif q_lower in result["label"].lower():
            text_score = -5

        return (0 if in_ap else 1, text_score, dist_from_amaravati)

    results.sort(key=calculate_relevance)

    # Return up to 8 results
    final_results = results[:8]

    # Cache the results
    geocode_cache[cache_key] = (time.time(), final_results)

    log.info(f"Geocode for '{q}' returned {len(final_results)} results")

    # Log the first result for debugging
    if final_results:
        log.info(
            f"Top result: {final_results[0]['mainText']} at ({final_results[0]['lat']}, {final_results[0]['lng']})"
        )

    return final_results


@app.get("/health")
def health():
    return {
        "status": "ok",
        "db": "connected" if db else "unavailable (mock mode)",
        "time": datetime.utcnow().isoformat(),
    }
