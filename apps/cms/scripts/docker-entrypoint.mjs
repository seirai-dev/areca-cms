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

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = process.env.DATABASE_URL
const bucket = process.env.S3_BUCKET

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}
if (!bucket) {
  throw new Error('S3_BUCKET is required')
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const pool = new Pool({ connectionString: databaseUrl })
    try {
      await pool.query('select 1')
      await pool.end()
      return
    } catch (error) {
      await pool.end().catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      console.log(`waiting for postgres (${attempt}/30): ${message}`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  throw new Error('Postgres did not become ready')
}

async function runMigrations() {
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: join(appDir, 'drizzle') })
  await pool.end()
  console.log('database migrations applied')
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

await waitForPostgres()
await runMigrations()
await ensureBucket()

const child = spawn(process.execPath, [join(appDir, '.output/server/index.mjs')], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
})

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
