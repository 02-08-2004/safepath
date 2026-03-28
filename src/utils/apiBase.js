/**
 * API base URL for fetch().
 * - Dev (Vite): `/api` → proxied to uvicorn :8000
 * - Production build served from FastAPI on :8000: `''` → same origin (`/auth/...`, `/geocode`, …)
 */
export function getApiBase() {
  const v = import.meta.env.VITE_API_URL
  if (typeof v === 'string') return v
  return import.meta.env.DEV ? '/api' : ''
}

export const API_BASE = getApiBase()

/** WebSocket: dev talks to API on :8000; prod uses same host as the page. */
export function getWsUrl() {
  const v = import.meta.env.VITE_WS_URL
  if (typeof v === 'string' && v.length > 0) return v
  if (import.meta.env.DEV) return 'ws://127.0.0.1:8000/ws/location'
  if (typeof window !== 'undefined') {
    const p = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${p}//${window.location.host}/ws/location`
  }
  return 'ws://127.0.0.1:8000/ws/location'
}
