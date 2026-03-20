// ── PHASE 1: Live GPS Hook ──────────────────────────────────────────────────
// Uses browser navigator.geolocation.watchPosition to stream user coordinates.
// Returns the latest position, accuracy, speed, and any error message.

import { useState, useEffect, useRef } from 'react'

export function useGPS({ enabled = true } = {}) {
  const [position, setPosition]     = useState(null)   // [lat, lng]
  const [accuracy, setAccuracy]     = useState(null)   // metres
  const [speed, setSpeed]           = useState(null)   // m/s
  const [heading, setHeading]       = useState(null)   // degrees
  const [error, setError]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const watchId = useRef(null)

  useEffect(() => {
    if (!enabled) return
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.')
      setLoading(false)
      return
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude])
        setAccuracy(Math.round(pos.coords.accuracy))
        setSpeed(pos.coords.speed)
        setHeading(pos.coords.heading)
        setError(null)
        setLoading(false)
      },
      (err) => {
        // User denied → fall back to city centre (Mangalagiri, AP)
        if (err.code === 1) {
          setPosition([16.4307, 80.5195])
          setError('GPS permission denied — using demo location.')
        } else {
          setError(err.message)
        }
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        maximumAge:         5_000,   // accept cached fix up to 5s old
        timeout:            10_000,  // give up after 10s
      }
    )

    return () => {
      if (watchId.current != null)
        navigator.geolocation.clearWatch(watchId.current)
    }
  }, [enabled])

  return { position, accuracy, speed, heading, error, loading }
}
