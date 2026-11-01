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
    // The test files share one scratch content folder (the pid above is the
    // main process, not a worker), and writeFixtureContent rewrites it. Run
    // files one at a time so one file never deletes what another is writing.
    fileParallelism: false,
    env: {
      ARECA_CONTENT_DIR: join(scratch, 'content'),
      ARECA_MEDIA_DIR: join(scratch, 'media'),
    },
  },
})
