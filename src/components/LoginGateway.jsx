import { useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { jwtDecode } from 'jwt-decode'
import { sendPhoneOTP, verifyPhoneOTP } from '../utils/api.js'
import styles from './LoginGateway.module.css'

export default function LoginGateway({ onAuthenticated }) {
  // Steps: 'GOOGLE' -> 'PHONE' -> 'PHONE_OTP' -> DONE
  const [step, setStep] = useState('GOOGLE')
  
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneOTP, setPhoneOTP] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleError = (e) => {
    try {
      const parsed = JSON.parse(e.message)
      setError(parsed.detail || "Authentication error failed")
    } catch {
      setError(e.message || "An unexpected error occurred")
    }
    setLoading(false)
  }

  const handleGoogleSuccess = (credentialResponse) => {
    try {
      const decoded = jwtDecode(credentialResponse.credential)
      if (decoded.email) {
        setEmail(decoded.email)
        setStep('PHONE')
      } else {
        setError("Could not parse email from Google response")
      }
    } catch (err) {
      setError("Failed to decode secure Google token")
    }
  }

  const handleGoogleError = () => {
    setError("Google Sign-in failed or was cancelled.")
  }

  const handlePhoneSubmit = async (e) => {
    e.preventDefault()
    if (phone.length < 10) return setError('Enter a valid 10-digit phone number')
    setError(null)
    setLoading(true)
    try {
      await sendPhoneOTP(phone)
      setStep('PHONE_OTP')
    } catch (e) { handleError(e) }
    setLoading(false)
  }

  const handlePhoneVerify = async (e) => {
    e.preventDefault()
    if (phoneOTP.length < 5) return setError('Enter a valid OTP')
    setError(null)
    setLoading(true)
    try {
      const res = await verifyPhoneOTP(phone, phoneOTP)
      // Save token locally and unlock app
      localStorage.setItem('safepath_auth', res.token)
      onAuthenticated()
    } catch (e) { handleError(e) }
    setLoading(false)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        
        <div className={styles.header}>
          <div className={styles.logo}>🛡️</div>
          <h1 className={styles.title}>Secure Login</h1>
          <p className={styles.subtitle}>
            {step === 'GOOGLE' 
              ? 'Verify your identity securely with Google to continue.' 
              : `Welcome ${email}! Now add your phone number for emergency routing.`}
          </p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {step === 'GOOGLE' && (
          <div className={styles.inputGroup} style={{ alignItems: 'center', marginTop: '1rem', marginBottom: '1rem' }}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              useOneTap
              theme="filled_black"
              shape="pill"
            />
          </div>
        )}

        {step === 'PHONE' && (
          <form className={styles.inputGroup} onSubmit={handlePhoneSubmit}>
            <label className={styles.label}>Phone Number</label>
            <input 
              type="tel" 
              className={styles.input} 
              placeholder="+91 80000 00000"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              autoFocus required
            />
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Routing...' : 'Send SMS Code →'}
            </button>
          </form>
        )}

        {step === 'PHONE_OTP' && (
          <form className={styles.inputGroup} onSubmit={handlePhoneVerify}>
            <label className={styles.label}>SMS Code Sent to {phone}</label>
            <input 
              type="text" 
              className={styles.input} 
              placeholder="e.g. 123456"
              value={phoneOTP}
              onChange={e => setPhoneOTP(e.target.value.replace(/\D/g, '').substring(0, 6))}
              autoFocus required
            />
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Finalizing...' : 'Unlock SafePath ➔'}
            </button>
            <p className={styles.resendText}>
              Since you don't have Twilio credentials active, use the test code <strong>123456</strong> for now.
            </p>
          </form>
        )}

        <div className={styles.steps}>
          <div className={`${styles.stepDot} ${step.includes('GOOGLE') ? styles.stepDotActive : ''}`} />
          <div className={`${styles.stepDot} ${step.includes('PHONE') ? styles.stepDotActive : ''}`} />
        </div>

      </div>
    </div>
  )
}
