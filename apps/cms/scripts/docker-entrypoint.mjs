import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { withMigrationLock } from './lib/migration-lock.mjs'
import { retryUntilDeadline, startupDeadlineMs } from './lib/startup-retry.mjs'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = process.env.DATABASE_URL
const bucket = process.env.S3_BUCKET

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}
if (!bucket) {
  throw new Error('S3_BUCKET is required')
}

// Waiting for Postgres and for another instance's migration lock share one
// deadline (STARTUP_DEADLINE_SECONDS). A migration that has started is not
// interrupted by it.
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

async function ensureBucket() {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  })

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
    console.log(`bucket already exists: ${bucket}`)
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
    console.log(`created bucket: ${bucket}`)
  }
}

try {
  await waitForPostgres()
  await runMigrations()
  await ensureBucket()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`startup failed, exiting: ${message}`)
  process.exit(1)
}

const child = spawn(
  process.execPath,
  [join(appDir, '.output/server/index.mjs')],
  {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
  },
)

// The server entry (and with it the publishing worker, scheduler and the
// first-run setup token) loads on the first request, so make one ourselves
// once the child listens instead of waiting for a user. Best effort only.
async function warmUp() {
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log('warm-up request to /api/health did not succeed; continuing')
}
void warmUp()

function shutdown(signal) {
  if (!child.killed) child.kill(signal)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

const code = await new Promise((resolve) => {
  child.on('exit', (exitCode, signal) => {
    resolve(exitCode ?? (signal ? 1 : 0))
  })
})

process.exit(code)
