import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // For local dev run `vercel dev` (serves /api on :3000) in one terminal
    // and `npm run dev` in another; Vite proxies /api calls to it.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
