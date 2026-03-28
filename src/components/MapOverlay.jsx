// ── MapOverlay Component ──────────────────────────────────────────────────────
// Floating panels on top of the map — incidents box REMOVED
// Added: live turn-by-turn navigation panel

import { useState, useEffect } from 'react'
import { scoreToBadge } from '../utils/safety.js'
import { sendSOS } from '../utils/api.js'
import styles from './MapOverlay.module.css'

function getDistance(a, b) {
  if (!a || !b) return Infinity
  const R = 6371000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const x = Math.sin(dLat/2) ** 2 +
    Math.cos(a[0] * Math.PI/180) * Math.cos(b[0] * Math.PI/180) * Math.sin(dLng/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
}

function getBearing(a, b) {
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const lat1 = a[0] * Math.PI / 180
  const lat2 = b[0] * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

function bearingToDirection(bearing) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round(bearing / 45) % 8]
}

function getTurnInstruction(prev, curr, next) {
  if (!prev || !next) return { icon: '↑', text: 'Continue straight' }
  const b1 = getBearing(prev, curr)
  const b2 = getBearing(curr, next)
  let diff = b2 - b1
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  if (diff > 30)  return { icon: '→', text: 'Turn right' }
  if (diff < -30) return { icon: '←', text: 'Turn left' }
  return { icon: '↑', text: 'Continue straight' }
}

export default function MapOverlay({
  selectedRoute,
  incidents,
  userPosition,
  isOffRoute,
  accuracy,
  wsStatus,
  onStartNav,
  onStopNav,
  navStarted,
}) {

  const [sosLoading, setSosLoading] = useState(false)
  const [sosDone, setSosDone] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  const badge = selectedRoute ? scoreToBadge(selectedRoute.safetyScore) : null

  useEffect(() => {
    if (!navStarted) {
      setStepIndex(0)
    }
  }, [navStarted])

  useEffect(() => {
    if (!navStarted || !selectedRoute || !userPosition) return
    const coords = selectedRoute.coords
    let closest = 0
    let minDist = Infinity
    coords.forEach((c, i) => {
      const d = getDistance(userPosition, c)
      if (d < minDist) { minDist = d; closest = i }
    })
    if (closest > stepIndex && closest < coords.length - 1) {
      setStepIndex(closest)
    }
  }, [userPosition, navStarted, selectedRoute])

  async function handleSOS() {
    if (!userPosition) return alert('GPS not yet available')
    setSosLoading(true)
    
    // 1. Try to send via backend Twilio API
    const result = await sendSOS(userPosition[0], userPosition[1])
    setSosLoading(false)
    setSosDone(true)
    setTimeout(() => setSosDone(false), 4000)
    
    // 2. Fallback: Open WhatsApp automatically
    const text = `EMERGENCY ALERT! I need help! Location: https://maps.google.com/?q=${userPosition[0]},${userPosition[1]}`
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(waUrl, '_blank')
  }

  const coords = selectedRoute?.coords || []
  const prev = coords[stepIndex - 1]
  const curr = coords[stepIndex]
  const next = coords[stepIndex + 1]

  const turn = getTurnInstruction(prev, curr, next)

  const distToNext = curr && userPosition ? getDistance(userPosition, curr) : null

  const remaining = coords.slice(stepIndex).reduce((acc, c, i, arr) => {
    if (i === 0) return acc
    return acc + getDistance(arr[i-1], c)
  }, 0)

  const remainingKm = (remaining / 1000).toFixed(1)
  const remainingMin = Math.round(remaining / 1000 / 5 * 60)

  return (
    <>
      {isOffRoute && (
        <div className={`${styles.alertBanner} fade-up`}>
          ⚠️ You are off the route — recalculating…
        </div>
      )}

      {navStarted && selectedRoute && (
        <div className={`${styles.navPanel} fade-up`}>

          <div className={styles.navTurn}>
            <div className={styles.navIcon}>{turn.icon}</div>

            <div className={styles.navInfo}>
              <div className={styles.navInstruction}>{turn.text}</div>

              {distToNext && (
                <div className={styles.navDist}>
                  in {distToNext < 1000
                    ? `${Math.round(distToNext)}m`
                    : `${(distToNext/1000).toFixed(1)}km`}
                </div>
              )}
            </div>
          </div>

          <div className={styles.navRemaining}>
            <span>{remainingKm} km</span>
            <span className={styles.navSep}>·</span>
            <span>{remainingMin} min remaining</span>
            <span className={styles.navSep}>·</span>
            <span style={{ color: badge?.color }}>
              {selectedRoute.safetyScore}/100 safe
            </span>
          </div>

          <button
            onClick={onStopNav}
            style={{
              marginTop:10,
              padding:'8px 14px',
              background:'#ef4444',
              color:'#fff',
              border:'none',
              borderRadius:'6px',
              cursor:'pointer'
            }}
          >
            ⛔ Stop Navigation
          </button>

        </div>
      )}

      {/* Legend */}
      <div className={`${styles.panel} ${styles.legend} fade-up`}>
        <div className={styles.panelTitle}>Safety Legend</div>
        <div className={styles.legendItem}><span className={styles.ldot} style={{ background:'#10b981'}} />Safe Zone</div>
        <div className={styles.legendItem}><span className={styles.ldot} style={{ background:'#f59e0b'}} />Moderate Risk</div>
        <div className={styles.legendItem}><span className={styles.ldot} style={{ background:'#ef4444'}} />High Risk</div>
        <div className={styles.legendItem}><span className={styles.ldot} style={{ background:'#00e5ff'}} />Selected Route</div>
        <div className={styles.legendItem}>📍 Incident Markers</div>
      </div>

      <button
        className={`${styles.sosBtn} ${sosDone ? styles.sosDone : ''}`}
        onClick={handleSOS}
        disabled={sosLoading}
        title="Send SOS with your live location"
      >
        {sosLoading ? '...' : sosDone ? '✓ Sent' : 'SOS'}
      </button>

      {accuracy && (
        <div className={styles.accuracyBadge}>
          <span className={styles.gpsDot} />
          GPS ±{accuracy}m
          {wsStatus === 'connected' &&
            <span className={styles.wsOnline}> · Live</span>}
        </div>
      )}

      {selectedRoute && badge && !navStarted && (
        <div className={`${styles.infoBar} fade-up`}>

          <div className={styles.infoItem}>
            <div className={styles.infoLabel}>AI RECOMMENDATION</div>
            <div className={styles.infoVal} style={{ color: badge.color }}>
              🛡 {selectedRoute.name}
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.infoItem}>
            <div className={styles.infoLabel}>ETA</div>
            <div className={styles.infoVal}>{selectedRoute.durationMin} min</div>
          </div>

          <div className={styles.divider} />

          <div className={styles.infoItem}>
            <div className={styles.infoLabel}>SAFETY SCORE</div>
            <div className={styles.infoVal} style={{ color: badge.color }}>
              {selectedRoute.safetyScore} / 100
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.infoItem}>
            <div className={styles.infoLabel}>DISTANCE</div>
            <div className={styles.infoVal}>{selectedRoute.distanceKm} km</div>
          </div>

          <button className={styles.startBtn} onClick={onStartNav}>
            ▶ Start Navigation
          </button>

        </div>
      )}

    </>
  )
}