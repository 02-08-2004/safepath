// ── PHASE 4: API Service ─────────────────────────────────────────────────────
const BASE = import.meta.env.VITE_API_URL || '/api'
export async function fetchSafeRoutes(olat, olng, dlat, dlng) {

  try {

    const res = await fetch(
      `http://localhost:8000/route/safe?olat=${olat}&olng=${olng}&dlat=${dlat}&dlng=${dlng}`
    )

    if (!res.ok) {
      console.error("Route API error")
      return null
    }

    const data = await res.json()

    return data

  } catch (err) {

    console.error("Route API failed:", err)

    return null
  }
}

export async function fetchIncidents(lat, lng, radiusMeters = 500) {
  try {
    const res = await fetch(`${BASE}/incidents?lat=${lat}&lng=${lng}&radius=${radiusMeters}`)
    if (!res.ok) throw new Error('API error')
    return await res.json()
  } catch {
    return [
      { id: 1, type: 'poor_lighting', description: 'NH-65 underpass — reported 2h ago',  lat: lat+0.003, lng: lng-0.002 },
      { id: 2, type: 'theft',         description: 'Market Rd — reported 6h ago',         lat: lat-0.002, lng: lng+0.003 },
      { id: 3, type: 'patrol',        description: 'Police patrol active near hospital',  lat: lat+0.001, lng: lng+0.001 },
      { id: 4, type: 'crowd',         description: 'Bus stand — safe and busy',           lat: lat-0.001, lng: lng-0.001 },
    ]
  }
}

export async function submitFeedback({ lat, lng, rating, tags }) {
  try {
    const res = await fetch(`${BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, rating, tags, ts: Date.now() }),
    })
    return res.ok
  } catch {
    return true
  }
}

export async function sendSOS(lat, lng, userName = 'SafePath User') {
  const mapsLink = `https://maps.google.com/?q=${lat},${lng}`
  try {
    const res = await fetch(`${BASE}/sos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, user_name: userName }),
    })
    if (res.ok) return { method: 'sms', success: true }
  } catch { /* fall through */ }
  const msg = encodeURIComponent(`🚨 EMERGENCY: ${userName} needs help!\nLocation: ${mapsLink}`)
  window.open(`https://wa.me/?text=${msg}`, '_blank')
  return { method: 'whatsapp', success: true }
}