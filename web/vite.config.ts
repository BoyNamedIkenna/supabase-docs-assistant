import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // While developing, calls to /api go to the Express server, so the browser never sees a second origin.
  server: { proxy: { '/api': 'http://localhost:3001' } },
})