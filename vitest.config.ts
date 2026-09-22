import { defineConfig } from 'vitest/config'

// Client unit tests only — the API server has its own node:test suite (npm run test:server).
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
