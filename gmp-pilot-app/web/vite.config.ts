import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://127.0.0.1:8000',
      '/lots': 'http://127.0.0.1:8000',
      '/inventory': 'http://127.0.0.1:8000',
      '/incoming-control': 'http://127.0.0.1:8000',
      '/sampling-tasks': 'http://127.0.0.1:8000',
      '/qc': 'http://127.0.0.1:8000',
      '/qa': 'http://127.0.0.1:8000',
    },
  },
})
