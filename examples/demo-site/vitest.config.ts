import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

// Fixtures are written and deleted by the tests: keep them away from the
// content and media that `areca pull` put in the project.
const scratch = join(tmpdir(), `northbound-demo-tests-${process.pid}`)

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      ARECA_CONTENT_DIR: join(scratch, 'content'),
      ARECA_MEDIA_DIR: join(scratch, 'media'),
    },
  },
})
