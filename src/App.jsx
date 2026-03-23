// ── App.jsx — SafePath Root Component ───────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import MapView       from './components/MapView.jsx'
import Sidebar       from './components/Sidebar.jsx'
import MapOverlay    from './components/MapOverlay.jsx'
import FeedbackModal from './components/FeedbackModal.jsx'
import { useGPS }             from './hooks/useGPS.js'
import { useLocationStream }  from './hooks/useLocationStream.js'
import { generateMockRoutes, isOffRoute } from './utils/safety.js'
import { fetchSafeRoutes, fetchIncidents } from './utils/api.js'
import styles from './App.module.css'

const DEFAULT_ORIGIN = ''
const DEFAULT_DEST   = ''
const DEFAULT_ORIGIN_COORDS = [16.4307, 80.5195]
const DEFAULT_DEST_COORDS   = [16.4520, 80.5080]

/* ── Geocode — tries multiple queries to find any AP location ── */
async function geocode(query) {
  const AP_MIN_LAT = 12.5, AP_MAX_LAT = 19.5
  const AP_MIN_LON = 76.5, AP_MAX_LON = 84.5

  // Try these queries in order until one finds a result in AP
  const attempts = [
    query + ', Andhra Pradesh, India',
    query + ', Telangana, India',
    query + ', India',
    query,
  ]

  for (const attempt of attempts) {
    try {
      const q = encodeURIComponent(attempt)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=10&countrycodes=in`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      if (!data || data.length === 0) continue

      // Filter to South India (AP, Telangana, Tamil Nadu, Karnataka)
      const southIndia = data.filter(p => {
        const lat = parseFloat(p.lat)
        const lon = parseFloat(p.lon)
        return lat >= AP_MIN_LAT && lat <= AP_MAX_LAT &&
               lon >= AP_MIN_LON && lon <= AP_MAX_LON
      })

      if (southIndia.length === 0) continue

      // Sort by proximity to Vijayawada center
      southIndia.sort((a, b) => {
        const da = Math.hypot(parseFloat(a.lat) - 16.5062, parseFloat(a.lon) - 80.6480)
        const db = Math.hypot(parseFloat(b.lat) - 16.5062, parseFloat(b.lon) - 80.6480)
        return da - db
      })

      const best = southIndia[0]
      console.log(`Geocoded "${query}" → ${best.lat}, ${best.lon} (${best.display_name.slice(0,60)})`)
      return [parseFloat(best.lat), parseFloat(best.lon)]

    } catch (e) {
      console.warn('Geocode attempt failed:', e)
    }
  }

  // Last resort: try without country filter
  try {
    const q = encodeURIComponent(query + ', Andhra Pradesh')
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    if (data && data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
    }
  } catch (e) {}

  return null
}

export default function App() {
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)
  const [dest,   setDest]   = useState(DEFAULT_DEST)
  const [originCoords, setOriginCoords] = useState(DEFAULT_ORIGIN_COORDS)
  const [destCoords,   setDestCoords]   = useState(DEFAULT_DEST_COORDS)

  const handleSetOrigin = (val) => { setOrigin(val); setOriginCoords(DEFAULT_ORIGIN_COORDS) }
  const handleSetDest   = (val) => { setDest(val);   setDestCoords(DEFAULT_DEST_COORDS) }
  const handleOriginSelect = (coords) => { setOriginCoords(coords) }
  const handleDestSelect   = (coords) => { setDestCoords(coords) }

  const [routes,          setRoutes]          = useState([])
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [routeLoading,    setRouteLoading]    = useState(false)
  const [loadingMsg,      setLoadingMsg]      = useState('Analyzing...')
  const [geocodeError,    setGeocodeError]    = useState(null)

  const [incidents,    setIncidents]    = useState([])
  const [showFeedback, setShowFeedback] = useState(false)
  const [navStarted,   setNavStarted]   = useState(false)
  const [toast,        setToast]        = useState(null)
  const [sheetOpen,    setSheetOpen]    = useState(false)

  const { position, accuracy, error: gpsError, loading: gpsLoading } = useGPS()
  const { wsStatus, serverMsg } = useLocationStream(position)

  useEffect(() => {
    if (!serverMsg) return
    if (serverMsg.action === 'reroute') {
      showToast('🔄 Server recommends a safer route — recalculating…')
      handleFindRoutes()
    }
  }, [serverMsg])

  const selectedRoute = routes.find(r => r.id === selectedRouteId)
  const offRoute = navStarted && selectedRoute
    ? isOffRoute(position, selectedRoute.coords) : false

  useEffect(() => {
    if (!navStarted) return
    const id = setInterval(() => { if (offRoute) handleFindRoutes() }, 30_000)
    return () => clearInterval(id)
  }, [navStarted, offRoute])

  useEffect(() => {
    if (!position) return
    fetchIncidents(position[0], position[1]).then(setIncidents)
  }, [position?.[0]?.toFixed(3), position?.[1]?.toFixed(3)])

  const handleFindRoutes = useCallback(async () => {
    setRouteLoading(true)
    setLoadingMsg('Finding location...')
    setGeocodeError(null)

    let oCoords = originCoords
    let dCoords = destCoords

    if (origin.trim() === '') {
      if (position) {
        oCoords = position
        setOriginCoords(position)
      } else {
        oCoords = DEFAULT_ORIGIN_COORDS
        setOriginCoords(DEFAULT_ORIGIN_COORDS)
      }
    } else {
      const resolved = await geocode(origin)
      if (resolved) {
        oCoords = resolved
        setOriginCoords(resolved)
      } else {
        setGeocodeError(`Could not find "${origin}" — try full name like "Neerukonda, Guntur"`)
        setRouteLoading(false)
        return
      }
    }

    if (dest.trim() === '') {
      setGeocodeError('Please enter a destination')
      setRouteLoading(false)
      return
    }

    const resolvedDest = await geocode(dest)
    if (resolvedDest) {
      dCoords = resolvedDest
      setDestCoords(resolvedDest)
    } else {
      setGeocodeError(`Could not find "${dest}" — try full name like "Benz Circle, Vijayawada"`)
      setRouteLoading(false)
      return
    }

    setLoadingMsg('Calculating routes...')

    const apiResult = await fetchSafeRoutes(
      oCoords[0], oCoords[1],
      dCoords[0], dCoords[1]
    )

    if (!apiResult || !apiResult.routes || apiResult.routes.length === 0) {
      setGeocodeError('Route not found — try different locations')
      setRouteLoading(false)
      return
    }
    // Clear any previous errors since routes succeeded
    setGeocodeError(null)

    const newRoutes = apiResult.routes
    setRoutes(newRoutes)
    setSelectedRouteId(newRoutes[0].id)
    setGeocodeError(null)
    setRouteLoading(false)
    setSheetOpen(false)

  }, [origin, dest, originCoords, destCoords, position])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleStartNav() {
    setNavStarted(true)
    setSheetOpen(false)
    showToast('▶ Navigation started — stay safe!')
  }

  function handleStopNav() {
    setNavStarted(false)
    setSelectedRouteId(routes[0]?.id ?? null)
    showToast('⛔ Navigation stopped')
  }

  return (
    <div className={styles.app}>

      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>🛡</div>
          SafePath
        </div>

        <div className={styles.statusRow}>
          {gpsLoading
            ? <span className={styles.pill} style={{ borderColor:'#f59e0b44', color:'#f59e0b' }}>⏳ Acquiring GPS…</span>
            : gpsError
            ? <span className={styles.pill} style={{ borderColor:'#ef444444', color:'#ef4444' }}>⚠ {gpsError}</span>
            : <span className={styles.pill}>
                <span className={styles.pulseDot} />
                Live Safety Data Active
              </span>
          }
        </div>

        <div className={styles.headerRight}>
          📍 Mangalagiri, AP
          <span className={`${styles.wsChip} ${wsStatus === 'connected' ? styles.wsOn : ''}`}>
            {wsStatus === 'connected' ? '● WS' : '○ WS'}
          </span>
        </div>
      </header>

      <div className={styles.body}>

        <Sidebar
          origin={origin}
          setOrigin={handleSetOrigin}
          onOriginSelect={handleOriginSelect}
          dest={dest}
          setDest={handleSetDest}
          onDestSelect={handleDestSelect}
          routes={routes}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
          onFindRoutes={handleFindRoutes}
          onOpenFeedback={() => setShowFeedback(true)}
          loading={routeLoading}
          loadingMsg={loadingMsg}
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />

        <button
          className={styles.sheetToggle}
          onClick={() => setSheetOpen(o => !o)}
        >
          {sheetOpen ? '✕ Close' : routes.length > 0 ? '🗺 View Routes' : '🔍 Plan Route'}
        </button>

        <div className={styles.mapWrap}>
          <MapView
            userPosition={position}
            routes={routes}
            selectedRouteId={selectedRouteId}
            incidents={incidents}
            originPos={originCoords}
            destPos={destCoords}
          />

          <MapOverlay
            selectedRoute={selectedRoute}
            incidents={incidents}
            userPosition={position}
            isOffRoute={offRoute}
            accuracy={accuracy}
            wsStatus={wsStatus}
            onStartNav={handleStartNav}
            onStopNav={handleStopNav}
            navStarted={navStarted}
          />
        </div>
      </div>

      {geocodeError && (
        <div className={styles.toast} style={{ background:'#7f1d1d', color:'#fff', bottom: '80px' }}>
          ⚠ {geocodeError}
        </div>
      )}

      {showFeedback && (
        <FeedbackModal userPosition={position} onClose={() => setShowFeedback(false)} />
      )}

      {toast && !geocodeError && (
        <div className={styles.toast}>{toast}</div>
      )}
    </div>
  )
}