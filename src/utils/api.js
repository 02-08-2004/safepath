import { API_BASE } from './apiBase.js'

/** @returns {{ token: string, email: string, displayName: string } | null} */
export function getAuthPayload() {
  const raw = localStorage.getItem('safepath_auth')
  if (!raw) return null
  try {
    const j = JSON.parse(raw)
    if (j && typeof j.token === 'string') return j
  } catch {
    /* legacy: raw token only */
  }
  return { token: raw, email: '', displayName: '' }
}

export function setAuthPayload(payload) {
  localStorage.setItem('safepath_auth', JSON.stringify(payload))
}

export function clearAuth() {
  localStorage.removeItem('safepath_auth')
}

function authHeaders(extra = {}) {
  const auth = getAuthPayload()
  const h = { ...extra }
  if (auth?.token) h.Authorization = `Bearer ${auth.token}`
  return h
}

function detailFromResponseText(t) {
  try {
    const j = JSON.parse(t)
    const d = j.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ')
    if (d != null) return String(d)
  } catch {
    /* use t */
  }
  return t
}

const AUTH_FETCH_MS = 25_000

async function fetchWithTimeout(url, options, ms = AUTH_FETCH_MS) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(
        'The server took too long to respond or is unreachable. Start the API (e.g. run uvicorn in the backend folder on port 8000) and try again.'
      )
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

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
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ lat, lng, rating, tags, ts: Date.now() }),
    })
    return response.ok
  } catch (error) {
    console.error('Feedback error:', error)
    return false
  }
}

export async function fetchMyFeedback() {
  const auth = getAuthPayload()
  if (!auth?.token) return { items: [] }
  try {
    const res = await fetch(`${API_BASE}/feedback/mine`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error(await res.text())
    return await res.json()
  } catch (e) {
    console.error('fetchMyFeedback:', e)
    return { items: [] }
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

export async function signupWithPassword(email, password) {
  const res = await fetchWithTimeout(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(detailFromResponseText(t))
  }
  return res.json()
}

export async function loginWithGoogleCredential(credential) {
  const res = await fetchWithTimeout(`${API_BASE}/auth/login/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(detailFromResponseText(t))
  }
  return res.json()
}