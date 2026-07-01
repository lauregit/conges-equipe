import { defineConfig } from 'vitest/config'

// Dedicated Vitest config (kept separate from vite.config.js so the React
// plugin / dev proxy don't load during tests). Both the pure frontend helpers
// and the serverless handler are plain logic, so the fast Node environment is
// enough — the handler takes an injectable `sql`, so no DB or module mocks.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'api/**/*.test.js'],
  },
})
