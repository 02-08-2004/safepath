// ── LocationSearch — Uses Geoapify for accurate Indian locations ──────────
import { useState, useEffect, useRef } from 'react'
import styles from './LocationSearch.module.css'

// Free Geoapify API key — 3000 requests/day free
// Get your own at https://www.geoapify.com/
const GEOAPIFY_KEY = import.meta.env.VITE_GEOAPIFY_KEY || '524b504e0c36417895491b54c705b72c'

async function searchPlaces(query) {
  // Try Geoapify first (most accurate for India)
  if (GEOAPIFY_KEY && GEOAPIFY_KEY !== '524b504e0c36417895491b54c705b72c') {
    try {
      const q = encodeURIComponent(query)
      const res = await fetch(
        `https://api.geoapify.com/v1/geocode/autocomplete?text=${q}&countrycodes=in&filter=rect:76.0,12.0,85.0,20.0&limit=6&apiKey=${GEOAPIFY_KEY}`,
      )
      const data = await res.json()
      if (data.features?.length > 0) {
        return data.features.map(f => ({
          label: f.properties.formatted,
          lat:   f.geometry.coordinates[1],
          lng:   f.geometry.coordinates[0],
        }))
      }
    } catch(e) {}
  }

  // Fallback: Nominatim with strict AP bounding box
  // AP bbox: north=19.5, south=12.5, east=84.5, west=76.5
  const results = []
  const seen    = new Set()

  const queries = [
    query + ' Andhra Pradesh India',
    query + ' Vijayawada',
    query + ' Guntur',
    query + ' Amaravati',
  ]

  for (const q of queries) {
    if (results.length >= 6) break
    try {
      const encoded = encodeURIComponent(q)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=4&countrycodes=in&viewbox=76.5,19.5,84.5,12.5&bounded=1&addressdetails=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'SafePath/1.0' } }
      )
      const data = await res.json()
      for (const p of data) {
        const lat = parseFloat(p.lat)
        const lon = parseFloat(p.lon)
        const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
        if (seen.has(key)) continue
        if (lat < 12.5 || lat > 19.5 || lon < 76.5 || lon > 84.5) continue
        seen.add(key)
        results.push({
          label: formatLabel(p),
          lat, lng: lon,
        })
      }
    } catch(e) {}
  }

  return results.slice(0, 6)
}

function formatLabel(p) {
  const a = p.address || {}
  const parts = []
  if (p.name) parts.push(p.name)
  if (a.suburb || a.neighbourhood) parts.push(a.suburb || a.neighbourhood)
  const city = a.city || a.town || a.village
  if (city && city !== p.name) parts.push(city)
  if (a.state_district) parts.push(a.state_district)
  if (a.state) parts.push(a.state)
  return [...new Set(parts)].filter(Boolean).join(', ') || p.display_name.slice(0,70)
}

export default function LocationSearch({ value, onChange, onSelect, placeholder, dotClass }) {
  const [suggestions, setSuggestions] = useState([])
  const [show,        setShow]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const debounceRef = useRef(null)
  const wrapRef     = useRef(null)

  useEffect(() => {
    const fn = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShow(false) }
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
    onSelect([s.lat, s.lng])
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
          <button className={styles.clear} onClick={() => { onChange(''); setSuggestions([]); setShow(false); onSelect(null) }}>✕</button>
        )}
      </div>

      {show && (
        <div className={styles.dropdown}>
          {suggestions.length > 0 ? (
            <>
              {suggestions.map((s, i) => (
                <div key={i} className={styles.item} onClick={() => handleSelect(s)}>
                  <span className={styles.pin}>📍</span>
                  <div className={styles.itemLabel}>{s.label}</div>
                </div>
              ))}
              <div className={styles.footer}>OpenStreetMap · AP focused</div>
            </>
          ) : !loading && value.length >= 2 ? (
            <div className={styles.noResult}>
              No results in AP — try: "Mangalagiri", "Benz Circle Vijayawada"
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}