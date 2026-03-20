// ── PHASE 2: WebSocket Location Stream ─────────────────────────────────────
// Opens a persistent WebSocket to the FastAPI backend.
// Sends GPS coordinates every time they update.
// Receives safety alerts and reroute commands from the server.

import { useEffect, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/location'

export function useLocationStream(position, userId = 'user_001') {
  const ws        = useRef(null)
  const [status, setStatus]   = useState('disconnected') // connected | disconnected | error
  const [serverMsg, setServerMsg] = useState(null)

  // Open socket once
  useEffect(() => {
    ws.current = new WebSocket(WS_URL)

    ws.current.onopen  = () => setStatus('connected')
    ws.current.onerror = () => setStatus('error')
    ws.current.onclose = () => setStatus('disconnected')
    ws.current.onmessage = (e) => {
      try { setServerMsg(JSON.parse(e.data)) } catch { /* ignore */ }
    }

    return () => {
      // Only close if socket is actually open
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.close()
      }
    }

  }, [])

  // Send coordinates whenever position changes
  useEffect(() => {
    if (!position || ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({
      user_id: userId,
      lat:     position[0],
      lng:     position[1],
      ts:      Date.now(),
    }))
  }, [position, userId])

  return { wsStatus: status, serverMsg }
}