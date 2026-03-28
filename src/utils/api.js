const API_BASE = import.meta.env.VITE_API_URL || '/api'

export async function fetchSafeRoutes(olat, olng, dlat, dlng) {
  try {
    const url = `${API_BASE}/route/safe?olat=${olat}&olng=${olng}&dlat=${dlat}&dlng=${dlng}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('Fetch safe routes error:', error)
    return { routes: [] }
  }
}

export async function fetchIncidents(lat, lng, radius = 500) {
  try {
    const url = `${API_BASE}/incidents?lat=${lat}&lng=${lng}&radius=${radius}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('Fetch incidents error:', error)
    // fallback mock incidents
    return [
      { id: 1, type: 'poor_lighting', description: 'NH-65 underpass — reported 2h ago',  lat: lat+0.003, lng: lng-0.002, severity: 3 },
      { id: 2, type: 'theft',         description: 'Market Rd — reported 6h ago',         lat: lat-0.002, lng: lng+0.003, severity: 2 },
      { id: 3, type: 'patrol',        description: 'Police patrol active near hospital',  lat: lat+0.001, lng: lng+0.001, severity: 1 },
      { id: 4, type: 'crowd',         description: 'Bus stand — safe and busy',           lat: lat-0.001, lng: lng-0.001, severity: 1 },
    ]
  }
}

export async function submitFeedback({ lat, lng, rating, tags }) {
  try {
    const response = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, rating, tags, ts: Date.now() }),
    })
    return response.ok
  } catch (error) {
    console.error('Feedback error:', error)
    return false
  }
}

export async function sendSOS(lat, lng, userName = 'SafePath User') {
  try {
    const response = await fetch(`${API_BASE}/sos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, user_name: userName }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('SOS error:', error)
    return { status: 'error', message: error.message }
  }
}

// ── Authentication ────────────────────────────────────────────────────────────

export async function sendEmailOTP(email) {
  const res = await fetch(`${API_BASE}/auth/email/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function verifyEmailOTP(email, otp) {
  const res = await fetch(`${API_BASE}/auth/email/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function sendPhoneOTP(phone) {
  const res = await fetch(`${API_BASE}/auth/phone/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function verifyPhoneOTP(phone, otp) {
  const res = await fetch(`${API_BASE}/auth/phone/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}