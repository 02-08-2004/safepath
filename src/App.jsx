// ── App.jsx — SafePath Root Component ───────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import MapView       from './components/MapView.jsx'
import Sidebar       from './components/Sidebar.jsx'
import MapOverlay    from './components/MapOverlay.jsx'
import FeedbackModal from './components/FeedbackModal.jsx'
import { useGPS }             from './hooks/useGPS.js'
import { useLocationStream }  from './hooks/useLocationStream.js'
import { isOffRoute } from './utils/safety.js'
import { fetchSafeRoutes, fetchIncidents } from './utils/api.js'
import LoginGateway from './components/LoginGateway.jsx'
import styles from './App.module.css'

const DEFAULT_ORIGIN = ''
const DEFAULT_DEST   = ''
const DEFAULT_ORIGIN_COORDS = [16.4307, 80.5195]
const DEFAULT_DEST_COORDS   = [16.4520, 80.5080]

// Use env variable for API base — works both locally and on Render
const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function geocode(query) {
  try {
    const res = await fetch(`${API_BASE}/geocode?q=${encodeURIComponent(query)}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data || data.length === 0) return null
    console.log(`Geocoded "${query}" → ${data[0].lat}, ${data[0].lng} (${data[0].label})`)
    return [data[0].lat, data[0].lng, data[0].label]
  } catch (e) {
    console.warn('Geocode failed:', e)
    return null
  }
}

export default function App() {
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)
  const [dest,   setDest]   = useState(DEFAULT_DEST)
  const [originCoords, setOriginCoords] = useState(DEFAULT_ORIGIN_COORDS)
  const [destCoords,   setDestCoords]   = useState(DEFAULT_DEST_COORDS)
  const [originName, setOriginName] = useState('')
  const [destName, setDestName] = useState('')
  const [originPlace, setOriginPlace] = useState(null)
  const [destPlace, setDestPlace] = useState(null)

  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('safepath_auth'))

  const handleSetOrigin = (val) => {
    setOrigin(val)
    setOriginPlace(null)
  }

  const handleSetDest = (val) => {
    setDest(val)
    setDestPlace(null)
  }

  const handleOriginSelect = (place) => {
    setOriginPlace(place)
    setOrigin(place.mainText)
    setOriginCoords([place.lat, place.lng])
    setOriginName(place.label)
    console.log('Origin selected:', place)
  }

  const handleDestSelect = (place) => {
    setDestPlace(place)
    setDest(place.mainText)
    setDestCoords([place.lat, place.lng])
    setDestName(place.label)
    console.log('Destination selected:', place)
  }

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
  const [locationName, setLocationName] = useState('Mangalagiri, AP')

  // Reverse geocode to get real location name
  useEffect(() => {
    if (!position) return
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${position[0]}&lon=${position[1]}&format=json`,
      { headers: { "Accept-Language": "en" } }
    )
    .then(r => r.json())
    .then(d => {
      const a = d.address || {}
      const name = a.village || a.suburb || a.neighbourhood || a.town || a.city || a.county || ""
      const state = a.state_district || a.state || "AP"
      if (name) setLocationName(`${name}, ${state}`)
    })
    .catch(() => {})
  }, [position?.[0]?.toFixed(2), position?.[1]?.toFixed(2)]) // eslint-disable-line

  useEffect(() => {
    if (!serverMsg) return
    if (serverMsg.action === 'reroute') {
      showToast('🔄 Server recommends a safer route — recalculating…')
      handleFindRoutes()
    }
  }, [serverMsg]) // eslint-disable-line

  const selectedRoute = routes.find(r => r.id === selectedRouteId)
  const offRoute = navStarted && selectedRoute
    ? isOffRoute(position, selectedRoute.coords) : false

  useEffect(() => {
    if (!navStarted) return
    const id = setInterval(() => { if (offRoute) handleFindRoutes() }, 30_000)
    return () => clearInterval(id)
  }, [navStarted, offRoute]) // eslint-disable-line

  useEffect(() => {
    if (!position) return
    fetchIncidents(position[0], position[1]).then(setIncidents)
  }, [position?.[0]?.toFixed(3), position?.[1]?.toFixed(3)]) // eslint-disable-line

  const handleFindRoutes = useCallback(async () => {
    setRouteLoading(true)
    setLoadingMsg('Finding location...')
    setGeocodeError(null)

    let oCoords = originCoords
    let dCoords = destCoords
    let oLabel  = originName
    let dLabel  = destName

    // Handle origin
    if (!origin || origin.trim() === '') {
      if (position) {
        oCoords = position
        setOriginCoords(position)
        oLabel = 'Current Location'
      } else {
        oCoords = DEFAULT_ORIGIN_COORDS
        setOriginCoords(DEFAULT_ORIGIN_COORDS)
      }
    } else if (originPlace) {
      oCoords = [originPlace.lat, originPlace.lng]
      oLabel  = originPlace.label
    } else {
      const resolved = await geocode(origin)
      if (resolved) {
        oCoords = [resolved[0], resolved[1]]
        oLabel  = resolved[2] || origin
        setOriginCoords(oCoords)
        setOriginName(oLabel)
      } else {
        setGeocodeError(`Could not find "${origin}" — try full name like "Neerukonda, Guntur"`)
        setRouteLoading(false)
        return
      }
    }

    // Handle destination
    if (!dest || dest.trim() === '') {
      setGeocodeError('Please enter a destination')
      setRouteLoading(false)
      return
    } else if (destPlace) {
      dCoords = [destPlace.lat, destPlace.lng]
      dLabel  = destPlace.label
    } else {
      const resolvedDest = await geocode(dest)
      if (resolvedDest) {
        dCoords = [resolvedDest[0], resolvedDest[1]]
        dLabel  = resolvedDest[2] || dest
        setDestCoords(dCoords)
        setDestName(dLabel)
      } else {
        setGeocodeError(`Could not find "${dest}" — try full name like "Benz Circle, Vijayawada"`)
        setRouteLoading(false)
        return
      }
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

    setGeocodeError(null)
    const newRoutes = apiResult.routes
    setRoutes(newRoutes)
    setSelectedRouteId(newRoutes[0]?.id)
    setRouteLoading(false)
    setSheetOpen(false)
    showToast(`✅ Found ${newRoutes.length} routes! Tap "Start Navigation" to begin.`)

  }, [origin, dest, originCoords, destCoords, position, originPlace, destPlace]) // eslint-disable-line

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleStartNav() {
    if (!selectedRoute) { showToast('Please select a route first'); return }
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
      
      {!isAuthenticated && (
        <LoginGateway onAuthenticated={() => setIsAuthenticated(true)} />
      )}

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
          📍 {locationName}
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
            originName={originName}
            destName={destName}
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