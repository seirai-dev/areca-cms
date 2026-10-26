import { defineConfig } from 'vitest/config'

// This focused suite deliberately bypasses vitest.setup.ts (which loads local
// environment files). It only talks to a loopback HTTP server with fake keys.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/adapters/storage/s3-prefix.test.ts',
      'src/server/assets/file-http.test.ts',
      'src/adapters/storage/s3-timeouts.test.ts',
    ],
  },
})
