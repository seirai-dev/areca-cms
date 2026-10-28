import { availableParallelism } from 'node:os'

/**
 * Per-worker isolation for the integration suites.
 *
 * Every vitest fork worker (VITEST_POOL_ID 1..MAX_WORKERS) gets its own
 * PostgreSQL database, cloned from the migrated test database, its own Redis
 * logical database and its own S3 key prefix. Files that run in the same
 * worker still run one after another in that worker's database, so they keep
 * the sequential behaviour they had before. Files in different workers cannot
 * see each other's rows, queue entries or objects.
 *
 * Mailpit is one inbox for every worker; the mail helpers pick messages by
 * recipient, and every test uses a unique address.
 */

// Two vCPUs on the CI runner, four when it is upgraded. Capped so the number
// of Redis logical databases (16 by default) and Postgres connections stay sane.
export const MAX_WORKERS = Math.min(Math.max(availableParallelism(), 1), 8)

const DEFAULT_REDIS_URL = 'redis://localhost:6379'
const TEMPLATE_URL_KEY = 'ARECA_TEST_TEMPLATE_DATABASE_URL'

/** The integration suites run unless the unit job opts out. */
export function integrationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.SKIP_INTEGRATION_TESTS !== 'true' && Boolean(env.DATABASE_URL)
}

/**
 * The template must be a throwaway database. The authz matrix uses the same
 * idea: it refuses names without a test marker, and this guard stops the
 * per-worker clones from being made of a developer database.
 */
export function templateDatabaseName(databaseUrl: string) {
  const name = new URL(databaseUrl).pathname.slice(1)
  if (!/^[A-Za-z0-9_]+$/.test(name) || !/test/i.test(name)) {
    throw new Error(
      `Refusing to run integration suites against database "${name}": ` +
        'DATABASE_URL must point at a throwaway database whose name contains "test" ' +
        '(for example areca_test). Set SKIP_INTEGRATION_TESTS=true to run unit tests only.',
    )
  }
  return name
}

export function workerDatabaseName(templateName: string, workerId: number) {
  return `${templateName}_w${workerId}`
}

export function withDatabase(databaseUrl: string, name: string) {
  const url = new URL(databaseUrl)
  url.pathname = `/${name}`
  return url.toString()
}

/**
 * Run in every test file before its imports (vitest.setup.ts). Rewrites the
 * environment that `#/env` and `#/db` read at import time, so the worker talks
 * only to its own database, Redis logical database and S3 prefix.
 */
export function isolateWorkerEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (!integrationEnabled(env)) return

  // Keep the shared template URL: a file that is loaded again in the same
  // process must not derive "_w1_w1" from its own rewritten URL.
  env[TEMPLATE_URL_KEY] ??= env.DATABASE_URL
  const template = env[TEMPLATE_URL_KEY] as string

  const workerId = Number(env.VITEST_POOL_ID)
  if (!Number.isInteger(workerId) || workerId < 1 || workerId > MAX_WORKERS) {
    throw new Error(`Unexpected VITEST_POOL_ID "${env.VITEST_POOL_ID}"`)
  }

  const name = workerDatabaseName(templateDatabaseName(template), workerId)
  env.DATABASE_URL = withDatabase(template, name)
  // Redis logical database N, 1..8. Database 0 is left to the developer's own use.
  const redis = new URL(env.REDIS_URL ?? DEFAULT_REDIS_URL)
  redis.pathname = `/${workerId}`
  env.REDIS_URL = redis.toString()
  env.S3_PREFIX = `areca-test-w${workerId}`
}
