import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      WORKER_ENABLED: 'false',
      DOKPLOY_CREDENTIALS_ENCRYPTION_KEY:
        'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    },
  },
})
