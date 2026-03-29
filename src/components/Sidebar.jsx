import { useState, useEffect, useRef } from 'react'
import { scoreToBadge } from '../utils/safety.js'
import { API_BASE } from '../utils/apiBase.js'
import styles from './Sidebar.module.css'

const PRIORITIES = [
  { key: 'safety',   icon: '🛡', label: 'Safest'   },
  { key: 'balanced', icon: '⚖️', label: 'Balanced' },
  { key: 'fastest',  icon: '⚡', label: 'Fastest'  },
  { key: 'lit',      icon: '💡', label: 'Well-Lit' },
]

const FILTERS = [
  { key: 'lighting', icon: '💡', label: 'Street Lighting', default: true  },
  { key: 'crowd',    icon: '👥', label: 'Crowd Density',   default: true  },
  { key: 'patrol',   icon: '🚔', label: 'Police Patrol',   default: true  },
  { key: 'crime',    icon: '⚠️', label: 'Crime Reports',   default: true  },
  { key: 'cctv',     icon: '📹', label: 'CCTV Coverage',   default: false },
  { key: 'hospital', icon: '🏥', label: 'Near Hospitals',  default: false },
]

const PREDEFINED_LOCATIONS = {
  'srm': [{ mainText: 'SRM University - AP', secondText: 'Amaravati, Andhra Pradesh', label: 'SRM University - AP, Amaravati', lat: 16.4624338, lng: 80.5063794 }],
  'vit': [{ mainText: 'VIT University - AP', secondText: 'Amaravati, Andhra Pradesh', label: 'VIT University - AP, Amaravati', lat: 16.497815, lng: 80.524768 }],
  'neerukonda': [{ mainText: 'Neerukonda', secondText: 'Amaravati, Andhra Pradesh', label: 'Neerukonda, Amaravati', lat: 16.4817, lng: 80.5114 }],
  'mangalagiri': [{ mainText: 'Mangalagiri', secondText: 'Guntur, Andhra Pradesh', label: 'Mangalagiri, Andhra Pradesh', lat: 16.4333, lng: 80.5667 }],
  'guntur': [{ mainText: 'Guntur', secondText: 'Andhra Pradesh', label: 'Guntur, Andhra Pradesh', lat: 16.3067, lng: 80.4365 }],
  'vijayawada': [{ mainText: 'Vijayawada', secondText: 'Andhra Pradesh', label: 'Vijayawada, Andhra Pradesh', lat: 16.5062, lng: 80.6480 }],
  'amaravati': [{ mainText: 'Amaravati', secondText: 'Andhra Pradesh', label: 'Amaravati, Andhra Pradesh', lat: 16.5062, lng: 80.6480 }],
}

export default function Sidebar({
  origin, setOrigin, onOriginSelect, originPlace,
  dest,   setDest,   onDestSelect,   destPlace,
  routes,
  selectedRouteId,
  onSelectRoute,
  onFindRoutes,
  onOpenFeedback,
  loading,
  loadingMsg,
  isOpen,
  onClose,
}) {
  const [priority, setPriority] = useState('safety')
  const [meshActive, setMeshActive] = useState(false)
  const [filters,  setFilters]  = useState(
    Object.fromEntries(FILTERS.map(f => [f.key, f.default]))
  )

  const [originSuggestions, setOriginSuggestions] = useState([])
  const [destSuggestions, setDestSuggestions] = useState([])
  const [showOriginDropdown, setShowOriginDropdown] = useState(false)
  const [showDestDropdown, setShowDestDropdown] = useState(false)


  const originRef = useRef(null)
  const destRef = useRef(null)

  function toggleFilter(key) {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const fetchSuggestions = async (query, setSuggestions) => {
    if (!query || query.length < 2) {
      setSuggestions([])
      return
    }
    const lower = query.toLowerCase().trim()
    if (PREDEFINED_LOCATIONS[lower]) {
      setSuggestions(PREDEFINED_LOCATIONS[lower])
      return
    }
    try {
      const url = `${API_BASE}/geocode?q=${encodeURIComponent(query)}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (Array.isArray(data) && data.length > 0) {
        setSuggestions(data.slice(0, 8))
      } else {
        setSuggestions([])
      }
    } catch (error) {
      console.error('Geocode fetch error:', error)
      setSuggestions([])
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (origin && origin.length >= 2 && !originPlace) {
        fetchSuggestions(origin, setOriginSuggestions)
        setShowOriginDropdown(true)
      } else if (!origin) {
        setOriginSuggestions([])
        setShowOriginDropdown(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [origin, originPlace])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (dest && dest.length >= 2 && !destPlace) {
        fetchSuggestions(dest, setDestSuggestions)
        setShowDestDropdown(true)
      } else if (!dest) {
        setDestSuggestions([])
        setShowDestDropdown(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [dest, destPlace])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (originRef.current && !originRef.current.contains(event.target)) setShowOriginDropdown(false)
      if (destRef.current && !destRef.current.contains(event.target)) setShowDestDropdown(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleOriginSelect = (place) => {
    if (onOriginSelect) onOriginSelect(place)
    setShowOriginDropdown(false)
    setOriginSuggestions([])
  }

  const handleDestSelect = (place) => {
    if (onDestSelect) onDestSelect(place)
    setShowDestDropdown(false)
    setDestSuggestions([])
  }

  const handleOriginChange = (e) => {
    const value = e.target.value
    setOrigin(value)
    if (value.length >= 2) {
      fetchSuggestions(value, setOriginSuggestions)
      setShowOriginDropdown(true)
    } else {
      setOriginSuggestions([])
      setShowOriginDropdown(false)
    }
  }

  const handleDestChange = (e) => {
    const value = e.target.value
    setDest(value)
    if (value.length >= 2) {
      fetchSuggestions(value, setDestSuggestions)
      setShowDestDropdown(true)
    } else {
      setDestSuggestions([])
      setShowDestDropdown(false)
    }
  }

  const handleFindRoutes = () => {
    onFindRoutes({ priority, filters })
  }

  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
      <section className={styles.section}>
        <p className={styles.label}>Plan Your Route</p>
        <div className={styles.inputGroup}>
          <div ref={originRef} className={styles.inputWrapper}>
            <div className={`${styles.dot} ${styles.dotOrigin}`} />
            <input
              type="text"
              className={styles.input}
              value={origin}
              onChange={handleOriginChange}
              placeholder="Starting point (e.g., SRM University)..."
              autoComplete="off"
            />
            {showOriginDropdown && originSuggestions.length > 0 && (
              <div className={styles.dropdown}>
                {originSuggestions.map((place, idx) => (
                  <div key={idx} className={styles.dropdownItem} onClick={() => handleOriginSelect(place)}>
                    <strong>{place.mainText}</strong>
                    <span className={styles.secondaryText}>{place.secondText}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={styles.connector} />
          <div ref={destRef} className={styles.inputWrapper}>
            <div className={`${styles.dot} ${styles.dotDest}`} />
            <input
              type="text"
              className={styles.input}
              value={dest}
              onChange={handleDestChange}
              placeholder="Destination..."
              autoComplete="off"
            />
            {showDestDropdown && destSuggestions.length > 0 && (
              <div className={styles.dropdown}>
                {destSuggestions.map((place, idx) => (
                  <div key={idx} className={styles.dropdownItem} onClick={() => handleDestSelect(place)}>
                    <strong>{place.mainText}</strong>
                    <span className={styles.secondaryText}>{place.secondText}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {originPlace && <div className={styles.selectedPlace}>📍 Start: {originPlace.label}</div>}
        {destPlace && <div className={styles.selectedPlace}>🏁 Destination: {destPlace.label}</div>}

        <p className={styles.label}>Optimize For</p>
        <div className={styles.priorityGrid}>
          {PRIORITIES.map(p => (
            <button key={p.key} className={`${styles.priorityBtn} ${priority === p.key ? styles.active : ''}`} onClick={() => setPriority(p.key)}>
              <span className={styles.priorityIcon}>{p.icon}</span>{p.label}
            </button>
          ))}
        </div>
        <button className={styles.findBtn} onClick={handleFindRoutes} disabled={loading || !originPlace || !destPlace}>
          {loading ? `🔄 ${loadingMsg || 'Analyzing...'}` : '🔍 Find Safe Routes'}
        </button>
      </section>

      <section className={styles.section}>
        <p className={styles.label}>Safety Filters</p>
        <div className={styles.filterList}>
          {FILTERS.map(f => (
            <div key={f.key} className={styles.filterItem}>
              <span className={styles.filterLabel}><span className={styles.filterIcon}>{f.icon}</span>{f.label}</span>
              <div className={`${styles.toggle} ${filters[f.key] ? styles.toggleOn : ''}`} onClick={() => toggleFilter(f.key)} role="switch" />
            </div>
          ))}
        </div>
        
        <p className={styles.label} style={{ marginTop: 14 }}>Advanced Networking</p>
        <div className={styles.filterItem} style={{ background: meshActive ? '#10b98120' : 'transparent', borderRadius: 8, padding: 8 }}>
            <span className={styles.filterLabel} style={{ color: meshActive ? '#10b981' : 'inherit' }}>
              📡 {meshActive ? 'Mesh Active (4 Nodes Linked)' : 'Offline Mesh Network'}
            </span>
            <div className={`${styles.toggle} ${meshActive ? styles.toggleOn : ''}`} onClick={() => setMeshActive(!meshActive)} role="switch" />
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.label}>AI Route Recommendations</p>
        {routes.length === 0 && <p className={styles.emptyState}>Search locations and tap Find Safe Routes.</p>}
        <div className={styles.routeCards}>
          {routes.map((route, i) => {
            const badge = scoreToBadge(route.safetyScore)
            const isSelected = route.id === selectedRouteId
            return (
              <div key={route.id} className={`${styles.routeCard} ${styles[badge.cls]} ${isSelected ? styles.selected : ''}`} onClick={() => { onSelectRoute(route.id); onClose?.() }}>
                <div className={styles.routeHeader}>
                  <span className={styles.routeName}>{route.name}</span>
                  <span className={`${styles.badge} ${styles['badge_' + badge.cls]}`}>{badge.label}</span>
                </div>
                <div className={styles.routeStats}>
                  <div className={styles.stat}><div className={styles.statVal}>{route.durationMin} min</div><div className={styles.statKey}>Time</div></div>
                  <div className={styles.stat}><div className={styles.statVal}>{route.distanceKm} km</div><div className={styles.statKey}>Distance</div></div>
                  <div className={styles.stat}><div className={styles.statVal}>{route.safetyScore}%</div><div className={styles.statKey}>Safety</div></div>
                </div>
                <div className={styles.barWrap}>
                  <div className={styles.barLabels}><span>Safety Score</span><span style={{ color: badge.color }}>{route.safetyScore} / 100</span></div>
                  <div className={styles.bar}><div className={styles.barFill} style={{ width: `${route.safetyScore}%`, background: badge.color }} /></div>
                </div>
                <div className={styles.highlights}>{route.highlights?.map((h, j) => <span key={j} className={styles.highlight}>{h}</span>)}</div>
              </div>
            )
          })}
        </div>
        <button className={styles.feedbackBtn} onClick={onOpenFeedback}>📝 Rate a Location</button>
      </section>
    </aside>
  )
}