// ── Sidebar Component ─────────────────────────────────────────────────────────
import { useState } from 'react'
import { scoreToBadge } from '../utils/safety.js'
import LocationSearch from './LocationSearch.jsx'
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

export default function Sidebar({
  origin, setOrigin, onOriginSelect,
  dest,   setDest,   onDestSelect,
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
  const [filters,  setFilters]  = useState(
    Object.fromEntries(FILTERS.map(f => [f.key, f.default]))
  )

  function toggleFilter(key) {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>

      {/* ── Route Input ── */}
      <section className={styles.section}>
        <p className={styles.label}>Plan Your Route</p>

        <div className={styles.inputGroup}>
          <LocationSearch
            value={origin}
            onChange={setOrigin}
            onSelect={onOriginSelect}
            placeholder="Starting point..."
            dotClass={styles.dotOrigin}
          />
          <div className={styles.connector} />
          <LocationSearch
            value={dest}
            onChange={setDest}
            onSelect={onDestSelect}
            placeholder="Destination..."
            dotClass={styles.dotDest}
          />
        </div>

        <p className={styles.label} style={{ marginTop: 14 }}>Optimize For</p>
        <div className={styles.priorityGrid}>
          {PRIORITIES.map(p => (
            <button
              key={p.key}
              className={`${styles.priorityBtn} ${priority === p.key ? styles.active : ''}`}
              onClick={() => setPriority(p.key)}
            >
              <span className={styles.priorityIcon}>{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>

        <button
          className={styles.findBtn}
          onClick={() => onFindRoutes(priority, filters)}
          disabled={loading || !origin || !dest}
        >
          {loading ? `🔄 ${loadingMsg || 'Analyzing...'}` : '🔍 Find Safe Routes'}
        </button>
      </section>

      {/* ── Safety Filters ── */}
      <section className={styles.section}>
        <p className={styles.label}>Safety Filters</p>
        <div className={styles.filterList}>
          {FILTERS.map(f => (
            <div key={f.key} className={styles.filterItem}>
              <span className={styles.filterLabel}>
                <span className={styles.filterIcon}>{f.icon}</span>
                {f.label}
              </span>
              <div
                className={`${styles.toggle} ${filters[f.key] ? styles.toggleOn : ''}`}
                onClick={() => toggleFilter(f.key)}
                role="switch"
                aria-checked={filters[f.key]}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Route Cards ── */}
      <section className={styles.section}>
        <p className={styles.label}>AI Route Recommendations</p>

        {routes.length === 0 && (
          <p className={styles.emptyState}>
            Search a location above, then tap Find Safe Routes.
          </p>
        )}

        <div className={styles.routeCards}>
          {routes.map((route, i) => {
            const badge      = scoreToBadge(route.safetyScore)
            const isSelected = route.id === selectedRouteId
            return (
              <div
                key={route.id}
                className={`${styles.routeCard} ${styles[badge.cls]} ${isSelected ? styles.selected : ''} fade-up`}
                style={{ animationDelay: `${i * 0.1}s` }}
                onClick={() => { onSelectRoute(route.id); onClose?.() }}
              >
                <div className={styles.routeHeader}>
                  <span className={styles.routeName}>{route.name}</span>
                  <span className={`${styles.badge} ${styles['badge_' + badge.cls]}`}>
                    {badge.label}
                  </span>
                </div>
                <div className={styles.routeStats}>
                  <div className={styles.stat}>
                    <div className={styles.statVal}>{route.durationMin} min</div>
                    <div className={styles.statKey}>Time</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statVal}>{route.distanceKm} km</div>
                    <div className={styles.statKey}>Distance</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statVal}>{route.safetyScore}%</div>
                    <div className={styles.statKey}>Safety</div>
                  </div>
                </div>
                <div className={styles.barWrap}>
                  <div className={styles.barLabels}>
                    <span>Safety Score</span>
                    <span style={{ color: badge.color }}>{route.safetyScore} / 100</span>
                  </div>
                  <div className={styles.bar}>
                    <div className={styles.barFill} style={{ width: `${route.safetyScore}%`, background: badge.color }} />
                  </div>
                </div>
                <div className={styles.highlights}>
                  {route.highlights?.map((h, j) => (
                    <span key={j} className={styles.highlight}>{h}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <button className={styles.feedbackBtn} onClick={onOpenFeedback}>
          📝 Rate a Location
        </button>
      </section>

    </aside>
  )
}