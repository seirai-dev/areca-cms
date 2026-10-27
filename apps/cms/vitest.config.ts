import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

import { MAX_WORKERS } from './vitest.worker-isolation.ts'

// Suites that need real PostgreSQL / Redis / S3. The unit job in CI sets
// SKIP_INTEGRATION_TESTS=true to leave these files out; the integration job
// provisions the services and runs them.
// Test files that import the database (or the shared DB test utilities) are
// detected automatically; list anything else that needs a service here.
const integrationSuites = [
  'src/adapters/storage/s3.test.ts',
  'src/db/schema.test.ts',
  'src/server/admin/admin.test.ts',
  'src/server/admin/audit-actors.test.ts',
  'src/server/admin/dokploy-credentials.test.ts',
  'src/server/admin/invitation-delivery.test.ts',
  'src/server/admin/owner-invariant.test.ts',
  'src/server/admin/was-live-migration.test.ts',
  'src/server/admin/setup.test.ts',
  'src/server/assets/assets.test.ts',
  'src/server/assets/retention.test.ts',
  'src/server/mail/outbox.db.test.ts',
  'src/server/content/collections.test.ts',
  'src/server/content/entries.test.ts',
  'src/server/content/sites-api.test.ts',
  'src/server/content/snapshot.test.ts',
  'src/server/ops/ops.db.test.ts',
  'src/server/publishing/publishing.test.ts',
  'src/server/publishing/worker-pool.db.test.ts',
  'src/server/security/authz-matrix.test.ts',
  'src/server/security/authz-routes.test.ts',
  'src/server/security/step-up.test.ts',
  'src/server/security/two-factor.test.ts',
]

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return testFiles(path)
    return entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const usesDatabase = /test-utils|['"]#\/db['"]|node-postgres|DATABASE_URL/

const skipped =
  process.env.SKIP_INTEGRATION_TESTS === 'true'
    ? [
        ...new Set([
          ...integrationSuites,
          ...testFiles('src').filter((file) =>
            usesDatabase.test(readFileSync(file, 'utf8')),
          ),
        ]),
      ]
    : []

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', ...skipped],
    // Files run in parallel. Each worker has its own database, Redis logical
    // database and S3 prefix (vitest.worker-isolation.ts), so they do not share
    // rows, queues or objects.
    maxWorkers: MAX_WORKERS,
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      WORKER_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      DOKPLOY_CREDENTIALS_ENCRYPTION_KEY:
        'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      AI_SETTINGS_ENCRYPTION_KEY:
        'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
    },
  },
})
