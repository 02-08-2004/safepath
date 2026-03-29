-- ── SafePath Database Setup ──────────────────────────────────────────────
-- Run once after creating the 'safepath' database:
--   psql -U postgres -c "CREATE DATABASE safepath;"
--   psql -U postgres -d safepath -f setup.sql

-- Enable PostGIS and Trigram support (Phase 2 & 4)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Safety Zones ────────────────────────────────────────────────────────
-- Polygonal areas with a pre-computed safety score
CREATE TABLE IF NOT EXISTS safety_zones (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  score       INTEGER CHECK (score BETWEEN 0 AND 100),
  description TEXT,
  geom        GEOMETRY(POLYGON, 4326)
);
CREATE INDEX IF NOT EXISTS idx_zones_geom ON safety_zones USING GIST (geom);

-- ── Incidents ────────────────────────────────────────────────────────────
-- Point-level safety events reported by users or synced from open data
CREATE TABLE IF NOT EXISTS incidents (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,          -- poor_lighting | theft | patrol | crowd | cctv
  description TEXT,
  severity    INTEGER DEFAULT 2,      -- 1 low … 3 high
  source      TEXT DEFAULT 'user',    -- user | data_gov_in | police_api
  reported_at TIMESTAMP DEFAULT NOW(),
  expires_at  TIMESTAMP,
  geom        GEOMETRY(POINT, 4326)
);
CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents (type);

-- ── GPS Tracks ───────────────────────────────────────────────────────────
-- Live GPS pings streamed over WebSocket (Phase 2)
CREATE TABLE IF NOT EXISTS gps_tracks (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  recorded_at TIMESTAMP DEFAULT NOW(),
  geom        GEOMETRY(POINT, 4326)
);
CREATE INDEX IF NOT EXISTS idx_tracks_user    ON gps_tracks (user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_geom    ON gps_tracks USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_tracks_time    ON gps_tracks (recorded_at DESC);

-- ── App users (email + password signup; returning users sign in with Google) ──
CREATE TABLE IF NOT EXISTS app_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ── User Feedback ────────────────────────────────────────────────────────
-- Safety ratings submitted from the Rate a Location modal (Phase 4)
CREATE TABLE IF NOT EXISTS feedback (
  id          SERIAL PRIMARY KEY,
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  tags        TEXT[],
  submitted_at TIMESTAMP DEFAULT NOW(),
  geom        GEOMETRY(POINT, 4326),
  user_email  TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_geom ON feedback USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback (user_email);

-- ── Seed: Demo incidents around Mangalagiri ──────────────────────────────
INSERT INTO incidents (type, description, severity, source, geom) VALUES
  ('poor_lighting', 'NH-65 underpass — poor street lighting',           3, 'user',
   ST_SetSRID(ST_Point(80.5170, 16.4280), 4326)),
  ('theft',         'Mobile snatch reported near market road',          2, 'user',
   ST_SetSRID(ST_Point(80.5210, 16.4330), 4326)),
  ('patrol',        'Police patrol active near NTR Health University',  1, 'user',
   ST_SetSRID(ST_Point(80.5090, 16.4500), 4326)),
  ('crowd',         'Bus stand area — busy and relatively safe',        1, 'user',
   ST_SetSRID(ST_Point(80.5195, 16.4307), 4326)),
  ('cctv',          'CCTV coverage near municipal office',              1, 'user',
   ST_SetSRID(ST_Point(80.5150, 16.4390), 4326))
ON CONFLICT DO NOTHING;

-- ── AP DATA NETWORK (Phase 4 Optimization) ───────────────────────────

CREATE TABLE IF NOT EXISTS road_nodes (
    osmid BIGINT PRIMARY KEY,
    geom  GEOMETRY(POINT, 4326) NOT NULL,
    x     DOUBLE PRECISION,
    y     DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_road_nodes_geom ON road_nodes USING GIST(geom);

CREATE TABLE IF NOT EXISTS road_edges (
    u      BIGINT NOT NULL,
    v      BIGINT NOT NULL,
    key    INT NOT NULL,
    osmid  BIGINT,
    name   TEXT,
    highway TEXT,
    length FLOAT,
    geom   GEOMETRY(LINESTRING, 4326) NOT NULL,
    PRIMARY KEY (u, v, key)
);
CREATE INDEX IF NOT EXISTS idx_road_edges_geom ON road_edges USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_road_edges_u    ON road_edges(u);
CREATE INDEX IF NOT EXISTS idx_road_edges_v    ON road_edges(v);

CREATE TABLE IF NOT EXISTS ap_locations (
    id     SERIAL PRIMARY KEY,
    name   TEXT,
    place_type TEXT,
    tags   JSONB,
    geom   GEOMETRY(POINT, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ap_locations_geom ON ap_locations USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_ap_locations_name_trgm ON ap_locations USING GIST (name gist_trgm_ops);
