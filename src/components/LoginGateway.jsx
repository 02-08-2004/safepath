import { useState, useEffect } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import {
  signupWithPassword,
  loginWithGoogleCredential,
  setAuthPayload,
  getAuthPayload,
} from '../utils/api.js'
import styles from './LoginGateway.module.css'

const googleOAuthReady = Boolean((import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim())

export default function LoginGateway({ onAuthenticated }) {
  /** First screen: create account (email + password). Returning users switch to Google sign-in. */
  const [mode, setMode] = useState('signup')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const switchToSignup = () => {
    setMode('signup')
    setError(null)
  }

  const switchToLogin = () => {
    setMode('login')
    setPassword('')
    setError(null)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    if (!email.includes('@')) return setError('Enter a valid email address')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    setError(null)
    setLoading(true)
    try {
      const res = await signupWithPassword(email, password)
      if (!res?.token) {
        setError('Server did not return a session. Try again or check the API logs.')
        return
      }
      try {
        setAuthPayload({
          token: res.token,
          email: res.email,
          displayName: res.display_name || res.email,
        })
      } catch {
        setError(
          'Could not save your session (browser storage blocked?). Allow cookies/storage for this site.'
        )
        return
      }
      if (!getAuthPayload()?.token) {
        setError('Session was not saved. Check browser settings and try again.')
        return
      }
      onAuthenticated()
    } catch (err) {
      setError(err.message || 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async (credentialResponse) => {
    setError(null)
    try {
      const cred = credentialResponse.credential
      if (!cred) {
        setError('Google did not return a credential')
        return
      }
      const res = await loginWithGoogleCredential(cred)
      if (!res?.token) {
        setError('Server did not return a session.')
        return
      }
      setAuthPayload({
        token: res.token,
        email: res.email,
        displayName: res.display_name || res.email,
      })
      if (!getAuthPayload()?.token) {
        setError('Could not save session in the browser.')
        return
      }
      onAuthenticated()
    } catch (err) {
      let msg = err.message || 'Google sign-in failed'
      try {
        const d = JSON.parse(msg)
        if (Array.isArray(d)) msg = d.map((x) => x.msg || x).join(' ')
        else if (d.detail) msg = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)
      } catch {
        /* keep msg */
      }
      setError(msg)
    }
  }

  const handleGoogleError = () => {
    setError(
      'Google Sign-in was cancelled, failed to load, or hit origin_mismatch. Check the setup note below and your Google Cloud OAuth client.'
    )
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.logo}>🛡️</div>
          <h1 className={styles.title}>
            {mode === 'login' ? 'Continue with Google' : 'Create your account'}
          </h1>
          <p className={styles.subtitle}>
            {mode === 'login'
              ? 'Choose the Google account whose email is the same one you used when you signed up — that is how SafePath recognises you.'
              : 'Enter your university or work email and a password to create your account.'}
          </p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {mode === 'login' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {!googleOAuthReady && (
              <div className={styles.error} style={{ borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}>
                Google Sign-In is not configured. Set VITE_GOOGLE_CLIENT_ID in <code>.env.local</code>.
              </div>
            )}
            {googleOAuthReady && (
              <div className={styles.inputGroup} style={{ alignItems: 'center' }}>
                <GoogleLogin
                  onSuccess={handleGoogleLogin}
                  onError={handleGoogleError}
                  theme="filled_black"
                  shape="pill"
                  text="continue_with"
                />
              </div>
            )}
            <p className={styles.hint}>
              New here?{' '}
              <button type="button" className={styles.linkBtn} onClick={switchToSignup}>
                Create an account
              </button>
            </p>
          </div>
        )}

        {mode === 'signup' && (
          <form className={styles.inputGroup} onSubmit={handleSignup}>
            <label className={styles.label}>University / work email</label>
            <input
              type="email"
              className={styles.input}
              placeholder="name@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <label className={styles.label}>Password (min 8 characters)</label>
            <input
              type="password"
              className={styles.input}
              placeholder="Choose a secure password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account →'}
            </button>
            <p className={styles.hint}>
              Already have an account?{' '}
              <button type="button" className={styles.linkBtn} onClick={switchToLogin}>
                Continue with Google
              </button>
            </p>
          </form>
        )}

        <div className={styles.modeTabs}>
          <button
            type="button"
            className={`${styles.modeTabBtn} ${mode === 'login' ? styles.modeTabActive : ''}`}
            onClick={switchToLogin}
          >
            Log in
          </button>
          <span className={styles.tabSep}>·</span>
          <button
            type="button"
            className={`${styles.modeTabBtn} ${mode === 'signup' ? styles.modeTabActive : ''}`}
            onClick={switchToSignup}
          >
            Sign up
          </button>
        </div>
      </div>
    </div>
  )
}
