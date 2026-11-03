import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { S3Client } from '@aws-sdk/client-s3'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { ensureBucket } from './lib/ensure-bucket.mjs'
import { withMigrationLock } from './lib/migration-lock.mjs'
import { createS3Namespace } from '../src/adapters/storage/s3-namespace.mjs'
import { retryUntilDeadline, startupDeadlineMs } from './lib/startup-retry.mjs'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
createS3Namespace(process.env.S3_PREFIX)
const databaseUrl = process.env.DATABASE_URL
const bucket = process.env.S3_BUCKET

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}
if (!bucket) {
  throw new Error('S3_BUCKET is required')
}

// Waiting for Postgres, another instance's migration lock and object storage
// share one deadline (STARTUP_DEADLINE_SECONDS). A migration that has started
// is not interrupted by it.
const deadline = Date.now() + startupDeadlineMs()

// Each probe connects and queries with its own timeout, so a half-open socket
// cannot hold the startup past the deadline.
const PROBE_TIMEOUT_MS = 5000

async function waitForPostgres() {
  await retryUntilDeadline(
    'postgres',
    async () => {
      const pool = new Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: PROBE_TIMEOUT_MS,
        query_timeout: PROBE_TIMEOUT_MS,
      })
      try {
        await pool.query('select 1')
      } finally {
        await pool.end().catch(() => {})
      }
    },
    { deadline },
  )
}

async function runMigrations() {
  // The advisory lock holds one connection; migrate() uses another.
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
  })
  try {
    // Only one instance migrates at a time; the others wait, then find
    // nothing left to apply.
    await withMigrationLock(
      pool,
      async () => {
        const db = drizzle(pool)
        await migrate(db, { migrationsFolder: join(appDir, 'drizzle') })
      },
      { timeoutMs: Math.max(deadline - Date.now(), 0) },
    )
    console.log('database migrations applied')
  } finally {
    await pool.end()
  }
}

async function ensureStorageBucket() {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  })
  // Access denied or an unreachable endpoint is retried until the deadline. The
  // bucket is only created on a definitive not-found (see ensure-bucket.mjs).
  await retryUntilDeadline(
    'object storage',
    () => ensureBucket(client, bucket),
    { deadline },
  )
}

try {
  await waitForPostgres()
  await runMigrations()
  await ensureStorageBucket()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`startup failed, exiting: ${message}`)
  process.exit(1)
}

// Idle keep-alive sockets must outlive the reverse proxy's, or the proxy can
// reuse a socket the server is closing and answer 502. Node closes idle
// sockets after 5s; Traefik keeps them for 90s. Nitro creates the server
// without options, so a preload sets the timeouts on every HTTP server.
const keepAliveMs = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS) || 120_000
const keepAlivePreload = `data:text/javascript,${encodeURIComponent(`
import http from 'node:http'
const create = http.createServer
http.createServer = function (...args) {
  const server = create.apply(this, args)
  server.keepAliveTimeout = ${keepAliveMs}
  server.headersTimeout = ${keepAliveMs + 1_000}
  return server
}
`)}`

const child = spawn(
  process.execPath,
  ['--import', keepAlivePreload, join(appDir, '.output/server/index.mjs')],
  {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
  },
)

function shutdown(signal) {
  if (!child.killed) child.kill(signal)
}

// The server entry (and with it the publishing worker, scheduler and the
// first-run setup token) loads on the first request, so make one ourselves
// once the child listens instead of waiting for a user. Its configuration is
// checked then too: a 500 from /api/health (which touches no dependency) means
// the server could not start, for example when REDIS_URL is missing in
// production. The container then stops with code 1 and the server's error is
// already in the log above. Without an answer the request is retried until the
// startup deadline.
async function warmUp() {
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`
  const until = Date.now() + startupDeadlineMs()
  while (Date.now() < until) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return
      if (response.status >= 500) {
        console.error(
          `startup failed, exiting: the server answered /api/health with HTTP ${response.status}; see the error above`,
        )
        shutdown('SIGTERM')
        process.exit(1)
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log('warm-up request to /api/health did not succeed; continuing')
}
void warmUp()

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

const code = await new Promise((resolve) => {
  child.on('exit', (exitCode, signal) => {
    resolve(exitCode ?? (signal ? 1 : 0))
  })
})

process.exit(code)
