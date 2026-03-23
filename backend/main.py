# ── SafePath FastAPI Backend ──────────────────────────────────────────────────
from email.mime import message
import os, logging, json
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional
from xmlrpc import client

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
log = logging.getLogger("safepath")

DB_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/safepath"
)


def get_db():
    try:
        return psycopg.connect(DB_URL, row_factory=dict_row, autocommit=True)
    except Exception as e:
        log.warning(f"DB unavailable ({e}) — running in mock mode")
        return None


db = get_db()


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
            except Exception:
                pass
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
                except Exception as e:
                    log.error(f"GPS insert error: {e}")
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
        return cur.fetchall()
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
        return {"status": "saved"}
    except Exception as e:
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

    results = []
    seen = set()
    attempts = [
        q + ", Andhra Pradesh, India",
        q + ", Guntur, India",
        q + ", Amaravati, India",
        q + ", India",
        q,
    ]
    for attempt in attempts:
        if len(results) >= 6:
            break
        try:
            r = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": attempt,
                    "format": "json",
                    "limit": 5,
                    "countrycodes": "in",
                    "addressdetails": 1,
                },
                headers={"Accept-Language": "en", "User-Agent": "SafePath/1.0"},
                timeout=8,
            )
            for p in r.json():
                lat, lng = float(p["lat"]), float(p["lon"])
                key = f"{lat:.3f},{lng:.3f}"
                if key in seen:
                    continue
                seen.add(key)
                a = p.get("address", {})
                main = p.get("name", q)
                parts = [
                    a.get("village") or a.get("suburb") or a.get("neighbourhood"),
                    a.get("city") or a.get("town") or a.get("municipality"),
                    a.get("state_district"),
                    a.get("state"),
                ]
                parts = list(dict.fromkeys(x for x in parts if x))
                results.append(
                    {
                        "label": ", ".join([main] + parts),
                        "mainText": main,
                        "secondText": ", ".join(parts),
                        "lat": lat,
                        "lng": lng,
                    }
                )
        except Exception as e:
            log.warning(f"Geocode attempt failed: {e}")
    # Sort AP results first
    results.sort(
        key=lambda x: (
            0 if 12.5 <= x["lat"] <= 19.5 and 76.5 <= x["lng"] <= 84.5 else 1,
            ((x["lat"] - 16.5062) ** 2 + (x["lng"] - 80.6480) ** 2),
        )
    )
    return results[:6]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "db": "connected" if db else "unavailable (mock mode)",
        "time": datetime.utcnow().isoformat(),
    }
