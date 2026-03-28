import { useEffect, useState } from 'react'
import { fetchMyFeedback, getAuthPayload } from '../utils/api.js'
import styles from './AccountModal.module.css'

function formatWhen(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return String(iso)
  }
}

export default function AccountModal({ onClose }) {
  const auth = getAuthPayload()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const data = await fetchMyFeedback()
      if (!cancelled) {
        setItems(data.items || [])
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>Your account</h2>
          <p className={styles.meta}>
            {auth?.displayName && <strong>{auth.displayName}</strong>}
            {auth?.displayName && auth?.email && ' · '}
            {auth?.email}
          </p>
        </div>

        <div className={styles.body}>
          <p className={styles.sectionLabel}>Your safety feedback</p>
          {loading && <p className={styles.empty}>Loading…</p>}
          {!loading && items.length === 0 && (
            <p className={styles.empty}>
              No feedback saved yet. Use &quot;Rate location&quot; on the map while signed in — entries
              show up here.
            </p>
          )}
          {!loading && items.length > 0 && (
            <div className={styles.list}>
              {items.map((row) => (
                <div key={row.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.stars}>{'⭐'.repeat(row.rating || 0)}</span>
                    <span className={styles.date}>{formatWhen(row.submitted_at)}</span>
                  </div>
                  {row.tags?.length > 0 && (
                    <div className={styles.tags}>
                      {row.tags.map((t) => (
                        <span key={t} className={styles.tag}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {row.lat != null && row.lng != null && (
                    <div className={styles.loc}>
                      📍 {Number(row.lat).toFixed(4)}, {Number(row.lng).toFixed(4)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
