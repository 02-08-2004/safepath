import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import styles from './MapView.module.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const ROUTE_COLORS = {
  safe:     '#10b981',
  balanced: '#f59e0b',
  fast:     '#ef4444',
}

function MapController({ userPosition, routes, selectedRouteId, incidents, originPos, destPos }) {
  const map         = useMap()
  const layersRef   = useRef({})
  const gpsLayerRef = useRef(null)
  const fittedRef   = useRef(false)

  // ── GPS dot — no popup ───────────────────────────────────────────────
  useEffect(() => {
    if (!userPosition) return
    if (gpsLayerRef.current) {
      gpsLayerRef.current.forEach(l => map.removeLayer(l))
    }
    const ping = L.circle(userPosition, {
      radius: 30, color: '#00e5ff', fillColor: '#00e5ff',
      fillOpacity: 0.15, weight: 1,
    }).addTo(map)
    const dot = L.circleMarker(userPosition, {
      radius: 8, color: '#0a0e1a', fillColor: '#00e5ff',
      fillOpacity: 1, weight: 2,
    }).addTo(map)
    gpsLayerRef.current = [ping, dot]
  }, [userPosition])  // eslint-disable-line

  // ── Draw routes ──────────────────────────────────────────────────────
  useEffect(() => {
    Object.values(layersRef.current).forEach(l => map.removeLayer(l))
    layersRef.current = {}

    if (routes.length === 0) return

    routes.forEach(route => {
      if (!route.coords || route.coords.length < 2) return
      const isSelected = route.id === selectedRouteId
      const color = ROUTE_COLORS[route.id] || '#00e5ff'
      const line = L.polyline(route.coords, {
        color,
        weight:    isSelected ? 6 : 3,
        opacity:   isSelected ? 0.95 : 0.4,
        dashArray: isSelected ? null : '8 6',
      }).addTo(map)
      if (isSelected) {
        line.bindTooltip(`${route.name} — ${route.durationMin} min`, {
          permanent: false, sticky: true, className: 'safepath-tooltip',
        })
      }
      layersRef.current[route.id] = line
    })

    // Fit map to routes only on first load
    if (!fittedRef.current) {
      const allCoords = routes.flatMap(r => r.coords || [])
      if (allCoords.length > 1) {
        try {
          map.fitBounds(allCoords, { padding: [60, 60], maxZoom: 15 })
          fittedRef.current = true
        } catch(e) {}
      }
    }
  }, [routes, selectedRouteId])  // eslint-disable-line

  // Reset fit on new route search
  useEffect(() => {
    fittedRef.current = false
  }, [routes.length])  // eslint-disable-line

  // ── Origin / destination markers — snap to route start/end ─────────
  useEffect(() => {
    const makeIcon = (label, color) => L.divIcon({
      html: `<div style="background:${color};color:#000;font-weight:800;
        font-family:'Syne',sans-serif;font-size:11px;width:28px;height:28px;
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        border:2px solid #0a0e1a;box-shadow:0 0 0 3px ${color}44">${label}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    })
    const markers = []
    // Use first/last coords of selected route if available (snaps to actual road)
    const selRoute = routes.find(r => r.id === selectedRouteId) || routes[0]
    const startPos = selRoute?.coords?.[0] || originPos
    const endPos   = selRoute?.coords?.[selRoute.coords.length - 1] || destPos
    if (startPos) markers.push(L.marker(startPos, { icon: makeIcon('A', '#00e5ff') }).addTo(map))
    if (endPos)   markers.push(L.marker(endPos,   { icon: makeIcon('B', '#7c3aed') }).addTo(map))
    return () => markers.forEach(m => map.removeLayer(m))
  }, [originPos, destPos, routes, selectedRouteId])  // eslint-disable-line

  // ── Incident markers ─────────────────────────────────────────────────
  useEffect(() => {
    const ICONS = {
      poor_lighting: { emoji: '🔦', color: '#f59e0b' },
      theft:         { emoji: '⚠️', color: '#ef4444' },
      patrol:        { emoji: '👮', color: '#10b981' },
      crowd:         { emoji: '👥', color: '#00e5ff' },
      cctv:          { emoji: '📹', color: '#7c3aed' },
    }
    const markers = incidents.map(inc => {
      const cfg = ICONS[inc.type] || { emoji: '📍', color: '#888' }
      const icon = L.divIcon({
        html: `<div style="background:${cfg.color}22;border:1px solid ${cfg.color}66;
          width:30px;height:30px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;font-size:14px">
          ${cfg.emoji}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      })
      return L.marker([inc.lat, inc.lng], { icon })
        .addTo(map)
        .bindPopup(`<b>${inc.type.replace('_', ' ')}</b><br>${inc.description}`)
    })
    return () => markers.forEach(m => map.removeLayer(m))
  }, [incidents])  // eslint-disable-line

  return null
}

export default function MapView({
  userPosition,
  routes         = [],
  selectedRouteId,
  incidents      = [],
  originPos,
  destPos,
  center         = [16.4307, 80.5195],
}) {
  return (
    <div className={styles.wrap}>
      <MapContainer
        center={center}
        zoom={13}
        zoomControl={false}
        attributionControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <MapController
          userPosition={userPosition}
          routes={routes}
          selectedRouteId={selectedRouteId}
          incidents={incidents}
          originPos={originPos}
          destPos={destPos}
        />
      </MapContainer>
    </div>
  )
}