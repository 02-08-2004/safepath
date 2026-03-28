// ── LocationSearch — Google Places + Nominatim fallback ──────────────────
import { useState, useEffect, useRef } from 'react'
import styles from './LocationSearch.module.css'

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

export default function LocationSearch({ value, onChange, onSelect, placeholder, dotClass }) {
  const [suggestions, setSuggestions] = useState([])
  const [show,        setShow]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const debounceRef  = useRef(null)
  const wrapRef      = useRef(null)
  const googleLoaded = useRef(false)

  useEffect(() => {
    if (!GOOGLE_KEY || googleLoaded.current) return
    if (window.google?.maps?.places) { googleLoaded.current = true; return }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&libraries=places`
    script.async = true
    script.onload = () => { googleLoaded.current = true }
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    const fn = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShow(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  function handleInput(e) {
    const val = e.target.value
    onChange(val)
    clearTimeout(debounceRef.current)
    if (val.length < 2) { setSuggestions([]); setShow(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const res = await searchPlaces(val)
      setSuggestions(res)
      setShow(true)
      setLoading(false)
    }, 400)
  }

  function handleSelect(s) {
    onChange(s.label)
    onSelect(s)
    setShow(false)
    setSuggestions([])
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.inputWrap}>
        <span className={`${styles.dot} ${dotClass || ''}`} />
        <input
          value={value}
          onChange={handleInput}
          onFocus={() => suggestions.length > 0 && setShow(true)}
          placeholder={placeholder}
          className={styles.input}
          autoComplete="off"
          spellCheck="false"
        />
        {loading && <span className={styles.spinner}>⌛</span>}
        {value && !loading && (
          <button className={styles.clear}
            onClick={() => { onChange(''); setSuggestions([]); setShow(false); onSelect(null) }}>✕</button>
        )}
      </div>

      {show && (
        <div className={styles.dropdown}>
          {suggestions.length > 0 ? (
            <>
              {suggestions.map((s, i) => (
                <div key={i} className={styles.item} onClick={() => handleSelect(s)}>
                  <span className={styles.pin}>📍</span>
                  <div className={styles.itemText}>
                    <div className={styles.mainText}>{s.mainText || s.label}</div>
                    {s.secondText && <div className={styles.secondText}>{s.secondText}</div>}
                  </div>
                </div>
              ))}
              <div className={styles.footer}>
                {GOOGLE_KEY && googleLoaded.current ? '⚡ Google Maps' : '📍 OpenStreetMap'}
              </div>
            </>
          ) : !loading ? (
            <div className={styles.noResult}>
              No results — try adding district name e.g. "Neerukonda Guntur"
            </div>
          ) : (
            <div className={styles.noResult}>Searching...</div>
          )}
        </div>
      )}
    </div>
  )
}

async function searchPlaces(query) {
  let results = []
  const seen    = new Set()

  // 1. Use backend proxy with High-Priority Amaravati Override Custom Matches
  try {
    const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const res  = await fetch(`${BASE}/geocode?q=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = await res.json()
      for (const item of data) {
        const key = `${item.lat.toFixed(3)},${item.lng.toFixed(3)}`
        if (!seen.has(key)) { seen.add(key); results.push(item) }
      }
    }
  } catch(e) {
    console.warn('Backend geocode failed:', e)
  }

  if (results.length >= 5) return results.slice(0, 6)

  // 2. Try Google Places fallback if key available and we still need results
  if (window.google?.maps?.places) {
    const googleResults = await googleSearch(query)
    for (const r of googleResults) {
      const key = `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`
      if (!seen.has(key)) { seen.add(key); results.push(r) }
    }
  }

  return results.slice(0, 6)
}

async function googleSearch(query) {
  return new Promise(resolve => {
    const svc = new window.google.maps.places.AutocompleteService()
    svc.getPlacePredictions({
      input: query,
      componentRestrictions: { country: 'in' },
      location: new window.google.maps.LatLng(16.5062, 80.6480),
      radius: 500000,
    }, (predictions, status) => {
      if (status !== 'OK' || !predictions) { resolve([]); return }
      const geocoder = new window.google.maps.Geocoder()
      Promise.all(predictions.slice(0, 5).map(p => new Promise(res => {
        geocoder.geocode({ placeId: p.place_id }, (results, st) => {
          if (st !== 'OK' || !results[0]) { res(null); return }
          const loc = results[0].geometry.location
          res({
            label:      p.description,
            mainText:   p.structured_formatting.main_text,
            secondText: p.structured_formatting.secondary_text,
            lat: loc.lat(), lng: loc.lng(),
          })
        })
      }))).then(items => resolve(items.filter(Boolean)))
    })
  })
}