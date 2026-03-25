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

function MapController({ userPosition, routes, selectedRouteId, incidents, originPos, destPos, originName, destName }) {
  const map         = useMap()
  const layersRef   = useRef({})
  const gpsLayerRef = useRef(null)
  const fittedRef   = useRef(false)

  // GPS dot
  useEffect(() => {
    if (!userPosition) return
    if (gpsLayerRef.current) gpsLayerRef.current.forEach(l => map.removeLayer(l))
    const ping = L.circle(userPosition, { radius: 30, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 0.15, weight: 2 }).addTo(map)
    const dot = L.circleMarker(userPosition, { radius: 8, color: '#ffffff', fillColor: '#00e5ff', fillOpacity: 1, weight: 2 }).addTo(map)
    gpsLayerRef.current = [ping, dot]
  }, [userPosition])

  // Draw routes
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
        weight:    isSelected ? 7 : 4,
        opacity:   isSelected ? 1 : 0.8,
        lineJoin: 'round',
        lineCap: 'round',
        smoothFactor: 0.5,
      }).addTo(map)

      if (isSelected) {
        const glowLine = L.polyline(route.coords, {
          color: color,
          weight: 12,
          opacity: 0.3,
          lineJoin: 'round',
          lineCap: 'round',
          smoothFactor: 0.5,
        }).addTo(map)
        layersRef.current[`${route.id}_glow`] = glowLine
      }

      const tooltipContent = `
        <div style="font-family: system-ui, sans-serif; font-size: 12px; padding: 8px; min-width: 180px; background: rgba(0,0,0,0.85); border-radius: 8px; color: white;">
          <strong style="color: ${color};">${route.name}</strong><br/>
          🛡️ Safety Score: ${route.safetyScore}%<br/>
          📏 Distance: ${route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)}m` : `${route.distanceKm.toFixed(1)}km`}<br/>
          ⏱️ Time: ${route.durationMin < 60 ? `${Math.round(route.durationMin)} min` : `${Math.floor(route.durationMin / 60)}h ${Math.round(route.durationMin % 60)}m`}
        </div>
      `
      line.bindTooltip(tooltipContent, {
        permanent: false,
        sticky: true,
        direction: 'top',
        offset: [0, -15],
        className: 'safepath-tooltip'
      })

      layersRef.current[route.id] = line
    })

    // Auto‑zoom to route bounds
    if (!fittedRef.current && routes.length > 0) {
      const allCoords = routes.flatMap(r => r.coords || [])
      if (allCoords.length > 1) {
        try {
          const bounds = L.latLngBounds(allCoords)
          map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 })
          fittedRef.current = true
        } catch(e) {}
      }
    }
  }, [routes, selectedRouteId])

  useEffect(() => { fittedRef.current = false }, [routes.length])

  // Origin / Destination markers (unchanged)
  useEffect(() => {
    const markers = []
    const selRoute = routes.find(r => r.id === selectedRouteId) || routes[0]

    let startPos = null
    if (selRoute?.coords?.[0]) startPos = selRoute.coords[0]
    else if (originPos) startPos = originPos

    let endPos = null
    if (selRoute?.coords?.[selRoute.coords.length - 1]) endPos = selRoute.coords[selRoute.coords.length - 1]
    else if (destPos) endPos = destPos

    if (startPos) {
      let lat, lng
      if (Array.isArray(startPos)) { lat = startPos[0]; lng = startPos[1] }
      else if (startPos.lat !== undefined) { lat = startPos.lat; lng = startPos.lng }
      if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        const originIcon = L.divIcon({
          html: `<div style="background: linear-gradient(135deg, #10b981, #059669); width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; color: white; cursor: pointer;">A</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16], className: 'custom-marker'
        })
        const marker = L.marker([lat, lng], { icon: originIcon }).addTo(map)
        marker.bindTooltip(originName || 'Starting Point', { permanent: false, sticky: true, direction: 'top', offset: [0, -18], className: 'marker-tooltip' })
        marker.bindPopup(`<div><strong>📍 Starting Point</strong><br/>${originName || 'Starting location'}</div>`)
        markers.push(marker)
      }
    }

    if (endPos) {
      let lat, lng
      if (Array.isArray(endPos)) { lat = endPos[0]; lng = endPos[1] }
      else if (endPos.lat !== undefined) { lat = endPos.lat; lng = endPos.lng }
      if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        const destIcon = L.divIcon({
          html: `<div style="background: linear-gradient(135deg, #ef4444, #dc2626); width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; color: white; cursor: pointer;">B</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16], className: 'custom-marker'
        })
        const marker = L.marker([lat, lng], { icon: destIcon }).addTo(map)
        marker.bindTooltip(destName || 'Destination', { permanent: false, sticky: true, direction: 'top', offset: [0, -18], className: 'marker-tooltip' })
        marker.bindPopup(`<div><strong>🏁 Destination</strong><br/>${destName || 'Destination location'}</div>`)
        markers.push(marker)
      }
    }

    return () => markers.forEach(m => map.removeLayer(m))
  }, [originPos, destPos, routes, selectedRouteId, originName, destName, map])

  // Incident markers
  useEffect(() => {
    const ICONS = {
      poor_lighting: { emoji: '💡', color: '#f59e0b', label: 'Poor Lighting' },
      theft:         { emoji: '⚠️', color: '#ef4444', label: 'Theft Reported' },
      patrol:        { emoji: '👮', color: '#10b981', label: 'Police Patrol' },
      crowd:         { emoji: '👥', color: '#00e5ff', label: 'High Crowd' },
      cctv:          { emoji: '📹', color: '#7c3aed', label: 'CCTV' },
    }
    const markers = incidents.map(inc => {
      const cfg = ICONS[inc.type] || { emoji: '📍', color: '#888', label: 'Incident' }
      const icon = L.divIcon({
        html: `<div style="background: ${cfg.color}dd; border: 2px solid white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); cursor: pointer;">${cfg.emoji}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], className: 'incident-marker'
      })
      const marker = L.marker([inc.lat, inc.lng], { icon }).addTo(map)
      marker.bindTooltip(cfg.label, { permanent: false, sticky: true, direction: 'top', offset: [0, -12], className: 'incident-tooltip' })
      marker.bindPopup(`<div><strong>${cfg.label}</strong><br/>${inc.description}<br/><small>Severity: ${inc.severity || 3}/5</small></div>`)
      return marker
    })
    return () => markers.forEach(m => map.removeLayer(m))
  }, [incidents, map])

  return null
}

export default function MapView({
  userPosition,
  routes         = [],
  selectedRouteId,
  incidents      = [],
  originPos,
  destPos,
  originName,
  destName,
  center         = [16.4624, 80.5064],
}) {
  return (
    <div className={styles.wrap}>
      <MapContainer
        center={center}
        zoom={15}
        zoomControl={true}
        attributionControl={true}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Google Satellite (bright, high‑res) – uses a public URL that works reliably */}
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
          maxZoom={20}
          attribution='&copy; <a href="https://maps.google.com">Google Maps</a>'
          subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
        />
        {/* Overlay: road labels and names */}
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}"
          maxZoom={20}
          attribution='&copy; <a href="https://maps.google.com">Google Maps</a>'
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
        />
      </MapContainer>
    </div>
  )
}