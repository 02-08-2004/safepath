// ── FeedbackModal ────────────────────────────────────────────────────────────
import { useState } from 'react'
import { submitFeedback } from '../utils/api.js'
import styles from './FeedbackModal.module.css'

const TAGS = [
  '💡 Good Lighting', '🌑 Poor Lighting', '👥 Crowded', '🏜 Isolated',
  '👮 Police Nearby', '⚠️ Felt Unsafe', '📹 CCTV Visible', '✅ Felt Safe',
]

export default function FeedbackModal({ userPosition, onClose }) {
  const [stars,   setStars]   = useState(0)
  const [active,  setActive]  = useState([])
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)

  function toggleTag(tag) {
    setActive(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  async function handleSubmit() {
    setLoading(true)
    await submitFeedback({
      lat:    userPosition?.[0],
      lng:    userPosition?.[1],
      rating: stars,
      tags:   active,
    })
    setLoading(false)
    setDone(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {done ? (
          <div className={styles.success}>✅ Thank you for your feedback!</div>
        ) : (
          <>
            <div className={styles.title}>📍 Rate This Location</div>
            <div className={styles.sub}>Your feedback improves safety for everyone.</div>

            <div className={styles.sectionLabel}>How safe did you feel?</div>
            <div className={styles.stars}>
              {[1,2,3,4,5].map(n => (
                <span
                  key={n}
                  className={`${styles.star} ${n <= stars ? styles.starOn : ''}`}
                  onClick={() => setStars(n)}
                >⭐</span>
              ))}
            </div>

            <div className={styles.sectionLabel}>What did you notice?</div>
            <div className={styles.tags}>
              {TAGS.map(tag => (
                <div
                  key={tag}
                  className={`${styles.tag} ${active.includes(tag) ? styles.tagOn : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              <button className={styles.btnOutline} onClick={onClose}>Cancel</button>
              <button
                className={styles.btnPrimary}
                onClick={handleSubmit}
                disabled={loading || stars === 0}
              >
                {loading ? 'Saving…' : 'Submit Feedback'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
