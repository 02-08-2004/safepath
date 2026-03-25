// ── PHASE 3: Safety Utilities ───────────────────────────────────────────────
// 1. calculateSafetyScore  – weighted score for a road segment (0-100)
// 2. isOffRoute            – Turf.js check: is user >threshold metres from route?
// 3. rankRoutes            – sort candidate routes by composite safety score

import * as turf from '@turf/turf'

// ─── Safety Score ─────────────────────────────────────────────────────────
// Each factor is normalised to 0-100 before weighting.
// Higher score = safer.
export function calculateSafetyScore(factors = {}) {
  const weights = {
    lighting:   0.30,
    crime:      0.25,   // inverted: fewer incidents = higher score
    crowd:      0.25,
    cctv:       0.20,
  }

  const lighting = factors.lighting        ?? 50
  const crime    = Math.max(0, 100 - (factors.crimeIncidents ?? 0) * 10)
  const crowd    = factors.crowdDensity    ?? 50
  const cctv     = factors.hasCctv        ? 100 : 20

  return Math.round(
    lighting * weights.lighting +
    crime    * weights.crime    +
    crowd    * weights.crowd    +
    cctv     * weights.cctv
  )
}

// ─── Route Badge ──────────────────────────────────────────────────────────
export function scoreToBadge(score) {
  if (score >= 75) return { label: 'SAFE',     color: '#10b981', cls: 'safe'     }
  if (score >= 50) return { label: 'MODERATE', color: '#f59e0b', cls: 'moderate' }
  return               { label: 'AVOID',     color: '#ef4444', cls: 'danger'   }
}

// ─── Off-Route Detection ──────────────────────────────────────────────────
// routeCoords: [[lat,lng], [lat,lng], ...]  (GeoJSON is [lng,lat] – we convert)
export function isOffRoute(userPos, routeCoords, thresholdMeters = 50) {
  if (!userPos || routeCoords.length < 2) return false

  const pt   = turf.point([userPos[1],  userPos[0]])
  const line = turf.lineString(routeCoords.map(c => [c[1], c[0]]))
  const snap = turf.nearestPointOnLine(line, pt)
  const dist = snap.properties.dist * 1000   // km → m

  return dist > thresholdMeters
}

// ─── Distance Along Route Remaining ──────────────────────────────────────
export function distanceRemaining(userPos, routeCoords) {
  if (!userPos || routeCoords.length < 2) return null

  const pt   = turf.point([userPos[1], userPos[0]])
  const line = turf.lineString(routeCoords.map(c => [c[1], c[0]]))
  const snap = turf.nearestPointOnLine(line, pt)

  // Slice from snapped point to destination
  const sliced = turf.lineSliceAlong(
    line,
    snap.properties.location,
    turf.length(line)
  )
  return Math.round(turf.length(sliced) * 1000)  // metres
}

// ─── Rank Routes ──────────────────────────────────────────────────────────
export function rankRoutes(routes) {
  return [...routes].sort((a, b) => b.safetyScore - a.safetyScore)
}

// ─── Mock Route Generator (used until Phase 4 real API is connected) ──────
export function generateMockRoutes() {
  return []
}

// Simple bezier-ish path interpolation for demo routes
function interpolatePath(from, to, variant) {
  const steps  = 12
  const latD   = to[0] - from[0]
  const lngD   = to[1] - from[1]
  const offsets = { safe: [0.004, -0.003], balanced: [0.002, 0.002], fast: [-0.001, 0.001] }
  const [latOff, lngOff] = offsets[variant] || [0, 0]

  return Array.from({ length: steps + 1 }, (_, i) => {
    const t   = i / steps
    const lat = from[0] + latD * t + latOff * Math.sin(Math.PI * t)
    const lng = from[1] + lngD * t + lngOff * Math.sin(Math.PI * t)
    return [lat, lng]
  })
}
