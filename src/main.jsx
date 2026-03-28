import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import 'leaflet/dist/leaflet.css'

import { GoogleOAuthProvider } from '@react-oauth/google'

const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()

if (import.meta.env.DEV && !clientId) {
  console.warn(
    '[SafePath] VITE_GOOGLE_CLIENT_ID is missing. Add it to .env.local (Web application OAuth client ID).'
  )
}

const app = <App />

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {clientId ? (
      <GoogleOAuthProvider clientId={clientId}>{app}</GoogleOAuthProvider>
    ) : (
      app
    )}
  </React.StrictMode>
)
