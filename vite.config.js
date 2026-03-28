import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Use one stable origin so Google OAuth "Authorized JavaScript origins" matches the URL you open.
    // If you prefer http://localhost:5173 instead, change host to 'localhost' and add that origin in Google Cloud.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        // 127.0.0.1 avoids Windows resolving "localhost" to IPv6 while uvicorn listens on IPv4
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true
      }
    }
  }
})