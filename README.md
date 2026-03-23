# 🛡 SafePath — Safe Route Recommendation System

> Navigate smarter. Prioritise safety over speed.

---

## Project Structure

```
safepath/
├── index.html
├── vite.config.js
├── package.json
│
├── src/
│   ├── main.jsx                   # Entry point
│   ├── App.jsx                    # Root component (all phases wired here)
│   ├── App.module.css
│   ├── index.css                  # Design system tokens
│   │
│   ├── hooks/
│   │   ├── useGPS.js              # PHASE 1 — live GPS via watchPosition
│   │   └── useLocationStream.js   # PHASE 2 — WebSocket to backend
│   │
│   ├── utils/
│   │   ├── safety.js              # PHASE 3 — scoring, deviation, mock routes
│   │   └── api.js                 # PHASE 4 — all API calls + SOS
│   │
│   └── components/
│       ├── MapView.jsx            # Leaflet map with live dot + routes
│       ├── MapView.module.css
│       ├── Sidebar.jsx            # Route input, filters, route cards
│       ├── Sidebar.module.css
│       ├── MapOverlay.jsx         # Panels on map (incidents, SOS, info bar)
│       ├── MapOverlay.module.css
│       ├── FeedbackModal.jsx      # Rate a Location modal
│       └── FeedbackModal.module.css
│
└── backend/
    ├── main.py                    # FastAPI server (all phases)
    ├── safety_score.py            # PHASE 3 — scoring algorithm
    ├── route_engine.py            # PHASE 3 — A* pathfinding with osmnx
    ├── setup.sql                  # Database tables + seed data
    ├── requirements.txt
    └── .env.example               # Copy to .env and fill in keys
```

---

## Phase 1 — Live GPS (Frontend Only)

**What it does:** Shows your real position on a dark OpenStreetMap map and
detects if you leave the selected route.

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start dev server
npm run dev
# → open http://localhost:5173
```

**Test GPS on desktop:** Open Chrome DevTools → More tools → Sensors →
Override Geolocation with any lat/lng. The blue dot moves as you change it.

**Test on phone:** Find your computer's local IP (`ipconfig` / `ifconfig`),
then visit `http://192.168.x.x:5173` on your phone.
Chrome will ask for location permission — allow it and the dot tracks you.

---

## Phase 2 — Backend + WebSocket

**What it does:** FastAPI server receives GPS pings over WebSocket and stores
them in PostgreSQL. The frontend sidebar and map load real incident data.

### Setup

```bash
# 1. Install PostgreSQL + PostGIS
#    Ubuntu:  sudo apt install postgresql postgis
#    Mac:     brew install postgresql postgis

# 2. Create the database
sudo -u postgres psql -c "CREATE DATABASE safepath;"
sudo -u postgres psql -d safepath -f backend/setup.sql

# 3. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL to your postgres credentials

# 4. Create Python virtual environment
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 5. Install Python packages
pip install -r requirements.txt

# 6. Run the backend
uvicorn main:app --reload --port 8000
# → API docs at http://localhost:8000/docs

# 7. In a separate terminal, run the frontend
cd ..
npm run dev
```

The header badge shows **● WS** in green when the WebSocket is connected.

---

## Phase 3 — AI Safety Engine

**What it does:** Downloads the real street graph from OpenStreetMap using
osmnx, assigns safety costs to every road segment, and runs safety-weighted
A* to find the three safest routes.

### Notes

- `osmnx` downloads map data on first run (~5–30 s depending on area size).
  The graph is cached in memory for 1 hour — subsequent calls are instant.
- The safety score formula:
  ```
  score = lighting×0.30 + crime×0.25 + crowd×0.25 + cctv×0.20
  ```
  Night mode (20:00–05:00) increases the lighting weight to 0.45 automatically.
- If osmnx fails or is slow, the server automatically falls back to mock routes
  so the frontend always has data.

No extra setup needed — osmnx is included in `requirements.txt`.

---

## Phase 4 — Real Data + SOS

### Crime data (data.gov.in)

1. Register at [data.gov.in](https://data.gov.in) → My Account → Generate API Key
2. Add the key to `backend/.env` as `DATA_GOV_API_KEY=...`
3. The backend syncs every hour automatically via APScheduler.

### SOS SMS (Twilio)

1. Create a free account at [twilio.com](https://www.twilio.com)
2. Note your **Account SID**, **Auth Token**, and **Twilio phone number**
3. Add them to `backend/.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx
   TWILIO_FROM_NUMBER=+1234567890
   EMERGENCY_CONTACT=+91XXXXXXXXXX
   ```
4. If Twilio is not configured the SOS button falls back to a **WhatsApp share
   link** automatically — no action needed.

---

## Environment Variables

| Variable              | Required | Description                        |
|-----------------------|----------|------------------------------------|
| `DATABASE_URL`        | Phase 2+ | PostgreSQL connection string       |
| `DATA_GOV_API_KEY`    | Phase 4  | India open data API key            |
| `TWILIO_ACCOUNT_SID`  | Phase 4  | Twilio account SID                 |
| `TWILIO_AUTH_TOKEN`   | Phase 4  | Twilio auth token                  |
| `TWILIO_FROM_NUMBER`  | Phase 4  | Your Twilio phone number           |
| `EMERGENCY_CONTACT`   | Phase 4  | Contact number to SMS on SOS       |

---

## API Reference

| Method | Endpoint          | Description                          |
|--------|-------------------|--------------------------------------|
| GET    | `/health`         | Server + DB status                   |
| GET    | `/incidents`      | Incidents near lat/lng               |
| GET    | `/route/safe`     | AI-ranked safe routes                |
| POST   | `/feedback`       | Submit a location safety rating      |
| POST   | `/sos`            | Send SOS SMS / WhatsApp              |
| WS     | `/ws/location`    | Stream GPS coordinates               |

Full interactive docs: `http://localhost:8000/docs`

---

## Quick Troubleshooting

| Symptom | Fix |
|---------|-----|
| Map tiles not loading | Check internet connection. Carto tiles require no key. |
| Blue GPS dot not moving | Allow location in browser; use DevTools Sensors to simulate |
| WS badge stays grey | Make sure backend is running on port 8000 |
| Route engine slow | First run downloads OSM data; subsequent calls use cache |
| SOS shows WhatsApp | Add Twilio keys to `backend/.env` for SMS |
| DB connection error | Check `DATABASE_URL` in `.env`; ensure PostgreSQL is running |
