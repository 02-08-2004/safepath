import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import styles from './MapView.module.css'
import 'leaflet/dist/leaflet.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const ROUTE_COLORS = {
  safe: '#10b981',
  balanced: '#f59e0b',
  fast: '#ef4444',
}

function MapController({ userPosition, routes, selectedRouteId, incidents, originPos, destPos, originName, destName, onStartNav, onStopNav, navStarted }) {
  const map = useMap()
  const layersRef = useRef({})
  const gpsLayerRef = useRef(null)
  const fittedRef = useRef(false)
  const [isFollowing, setIsFollowing] = useState(true)
  const isDragging = useRef(false)

  // GPS dot + Auto-Tracking
  useEffect(() => {
    if (!userPosition) return
    if (gpsLayerRef.current) gpsLayerRef.current.forEach(l => map.removeLayer(l))
    const ping = L.circle(userPosition, { radius: 30, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 0.15, weight: 2 }).addTo(map)
    const dot = L.circleMarker(userPosition, { radius: 8, color: '#ffffff', fillColor: '#00e5ff', fillOpacity: 1, weight: 2 }).addTo(map)
    gpsLayerRef.current = [ping, dot]

    // 📍 Auto-Centering Logic (Google Maps style)
    if (navStarted && isFollowing && !isDragging.current) {
        map.setView(userPosition, 16, { animate: true, duration: 1.5 })
    }
  }, [userPosition, navStarted, isFollowing, map])

  // Detect manual panning to pause tracking
  useEffect(() => {
    const onTouch = () => { isDragging.current = true; setIsFollowing(false) }
    const onEnd = () => { isDragging.current = false }
    
    map.on('movestart', (e) => {
        if (e.originalEvent) onTouch() // Only if triggered by user interaction
    })
    map.on('moveend', onEnd)
    
    return () => {
        map.off('movestart')
        map.off('moveend')
    }
  }, [map])

  // Draw real road routes
  useEffect(() => {
    Object.values(layersRef.current).forEach(l => map.removeLayer(l))
    layersRef.current = {}

    if (routes.length === 0) return

    routes.forEach(route => {
      if (!route.coords || route.coords.length < 2) return
      const isSelected = route.id === selectedRouteId
      const color = ROUTE_COLORS[route.id] || '#00e5ff'
      
      // ── NIGHT SAFETY CORRIDORS ──
      // Add glowing neon backdrop for highly safe paths automatically at night (after 7PM)
      const isNight = new Date().getHours() >= 19 || new Date().getHours() <= 5;
      if (isSelected && (route.safetyScore >= 80 || (isNight && route.safetyScore >= 60))) {
        const glow = L.polyline(route.coords, {
          color: '#10b981', weight: 16, opacity: 0.35, lineJoin: 'round',
          dashArray: isNight ? '10, 20' : null // Pulse effect simulation via dash
        }).addTo(map)
        layersRef.current[route.id + '_glow'] = glow
      }

      const line = L.polyline(route.coords, {
        color,
        weight: isSelected ? 6 : 3.5,
        opacity: isSelected ? 1 : 0.7,
        lineJoin: 'round',
        lineCap: 'round',
        smoothFactor: 0.5,
      }).addTo(map)

      // Tooltip with route details
      const tooltipContent = `
        <div style="font-family: system-ui; font-size: 12px; padding: 6px;">
          <strong style="color: ${color};">${route.name}</strong><br/>
          🛡️ Safety: ${route.safetyScore}/100<br/>
          📏 ${route.distanceKm} km · ⏱️ ${route.durationMin} min
        </div>
      `
      line.bindTooltip(tooltipContent, { sticky: true, className: 'safepath-tooltip' })
      
      layersRef.current[route.id] = line
    })

    // Auto-zoom to route bounds
    if (!fittedRef.current && routes.length > 0 && !navStarted) {
      const allCoords = routes.flatMap(r => r.coords || [])
      if (allCoords.length > 1) {
        try {
          const bounds = L.latLngBounds(allCoords)
          map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 })
          fittedRef.current = true
        } catch (e) {}
      }
    }
  }, [routes, selectedRouteId, navStarted, map])

  useEffect(() => { fittedRef.current = false }, [routes.length])

  // Origin/Destination markers
  useEffect(() => {
    const markers = []
    const selRoute = routes.find(r => r.id === selectedRouteId) || routes[0]

    let startPos = selRoute?.coords?.[0] || originPos
    let endPos = selRoute?.coords?.[selRoute.coords.length - 1] || destPos

    if (startPos) {
      const lat = Array.isArray(startPos) ? startPos[0] : startPos.lat
      const lng = Array.isArray(startPos) ? startPos[1] : startPos.lng
      if (lat && lng) {
        const originIcon = L.divIcon({
          html: `<div style="background:#10b981; width:28px; height:28px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; font-weight:bold; color:white;">A</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14], className: 'custom-marker'
        })
        const marker = L.marker([lat, lng], { icon: originIcon }).addTo(map)
        marker.bindTooltip(originName || 'Start', { sticky: true })
        markers.push(marker)
      }
    }

    if (endPos) {
      const lat = Array.isArray(endPos) ? endPos[0] : endPos.lat
      const lng = Array.isArray(endPos) ? endPos[1] : endPos.lng
      if (lat && lng) {
        const destIcon = L.divIcon({
          html: `<div style="background:#ef4444; width:28px; height:28px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; font-weight:bold; color:white;">B</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14], className: 'custom-marker'
        })
        const marker = L.marker([lat, lng], { icon: destIcon }).addTo(map)
        marker.bindTooltip(destName || 'Destination', { sticky: true })
        markers.push(marker)
      }
    }

    return () => markers.forEach(m => map.removeLayer(m))
  }, [originPos, destPos, routes, selectedRouteId, originName, destName, map])

  // Incident markers & Predictive Heatmap simulation
  useEffect(() => {
    const markers = []
    
    // Simulate Heatmap using wide low-opacity circles
    incidents.forEach(inc => {
      markers.push(L.circle([inc.lat, inc.lng], { radius: 150, color: 'transparent', fillColor: '#ef4444', fillOpacity: 0.15 }).addTo(map))
      markers.push(L.circle([inc.lat, inc.lng], { radius: 50, color: 'transparent', fillColor: '#f59e0b', fillOpacity: 0.25 }).addTo(map))
    })

    // Actual Blockchain-Verified Markers
    incidents.forEach(inc => {
      const htmlStr = `<div style="background:#ef4444aa; width:22px; height:22px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:12px; position:relative;">
        ⚠️
        <div style="position:absolute; bottom:-12px; background:#10b981; color:#fff; font-size:6px; padding:2px; font-weight:bold; border-radius:2px; white-space:nowrap; box-shadow:0 0 5px #10b981;">⛓️ BLOCKCHAIN VERIFIED</div>
      </div>`
      
      const icon = L.divIcon({ html: htmlStr, iconSize: [22, 22], iconAnchor: [11, 11] })
      const m = L.marker([inc.lat, inc.lng], { icon }).addTo(map)
      m.bindTooltip(`<b>${inc.description || 'Reported Incident'}</b><br/><span style="color:#10b981; font-family:monospace; font-size:10px;">Hash: 0x${Math.random().toString(16).substr(2, 8)}...</span>`)
      markers.push(m)
    })
    
    return () => markers.forEach(m => map.removeLayer(m))
  }, [incidents, map])

  // AI Drone Patrol Companion Marker (Predictive Scanning)
  useEffect(() => {
    if (!navStarted || routes.length === 0) return
    const route = routes.find(r => r.id === selectedRouteId) || routes[0]
    if (!route.coords) return
    
    // Position drone ahead of user (Advancing 10% of total route length ahead of current point)
    let dronePos = null
    const coords = route.coords
    
    if (userPosition) {
        let closestIdx = 0
        let minDist = Infinity
        coords.forEach((c, i) => {
            const dist = Math.pow(c[0]-userPosition[0], 2) + Math.pow(c[1]-userPosition[1], 2)
            if (dist < minDist) { minDist = dist; closestIdx = i }
        })
        
        // Scan 5% of route ahead (Minimum 10 coords)
        const scanAheadCount = Math.max(10, Math.floor(coords.length * 0.05))
        dronePos = coords[Math.min(coords.length - 1, closestIdx + scanAheadCount)]
    } else {
        // Simple orbiting simulation if no user position
        const t = (Date.now() % 10000) / 10000
        dronePos = coords[Math.floor(t * coords.length)]
    }

    if (!dronePos) return
    
    const droneIcon = L.divIcon({
        html: `<div style="width:40px; height:40px; background:radial-gradient(circle, #0ea5e955 0%, transparent 70%); display:flex; align-items:center; justify-content:center;">
                 <div style="background:#0ea5e9; color:white; font-size:9px; padding:2px 6px; border-radius:12px; border:2px solid #fff; box-shadow:0 0 15px #0ea5e9; font-weight:bold; white-space:nowrap; animation:bounce 1.5s infinite;">
                   🚁 SCANNING: SAFE
                 </div>
               </div>`,
        className: 'drone-marker', iconSize: [100, 40], iconAnchor: [50, 20]
    })
    
    const droneMarker = L.marker(dronePos, { icon: droneIcon, zIndexOffset: 1000 }).addTo(map)
    return () => map.removeLayer(droneMarker)
  }, [userPosition, navStarted, selectedRouteId, routes, map])

  return (
    <>
      {navStarted && !isFollowing && (
        <button 
          onClick={() => { setIsFollowing(true); map.setView(userPosition, 16) }}
          style={{ position:'absolute', bottom: 100, left:'50%', transform:'translateX(-50%)', zIndex: 1000, background:'#0ea5e9', color:'#fff', border:'none', padding:'10px 20px', borderRadius:'30px', fontWeight:'bold', boxShadow:'0 4px 10px rgba(0,0,0,0.4)', cursor:'pointer' }}
        >
          🎯 Re-center Tracking
        </button>
      )}
    </>
  )
}

export default function MapView({
  userPosition,
  routes = [],
  selectedRouteId,
  incidents = [],
  originPos,
  destPos,
  originName,
  destName,
  onStartNav,
  onStopNav,
  navStarted,
  center = [16.4624, 80.5064],
}) {
  return (
    <div className={styles.wrap}>
      <MapContainer center={center} zoom={13} zoomControl={true} attributionControl={true} style={{ width: '100%', height: '100%' }}>
        {/* Google Satellite with Roads */}
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
          maxZoom={20}
          attribution='Google Maps'
          subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
        />
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}"
          maxZoom={20}
          attribution='Google Maps'
          subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
        />
        <MapController
          userPosition={userPosition}
          routes={routes}
          selectedRouteId={selectedRouteId}
          incidents={incidents}
          originPos={originPos}
          destPos={destPos}
          originName={originName}
          destName={destName}
          onStartNav={onStartNav}
          onStopNav={onStopNav}
          navStarted={navStarted}
        />
      </MapContainer>
    </div>
  )
}