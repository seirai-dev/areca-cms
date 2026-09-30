#!/usr/bin/env node
// Runs Playwright against an ISOLATED CMS stack, so the e2e suite (whose setup
// spec wipes the database and the upload bucket) never touches your dev data.
//
//   pnpm test:e2e:isolated                 # setup + chromium projects
//   pnpm test:e2e:qa:isolated              # the QA walkthrough
//   node scripts/e2e-isolated.mjs --project=chromium e2e/auth.spec.ts
//
// Defaults (each can be overridden by setting it in the environment):
//   E2E_PORT=3100
//   E2E_DATABASE_URL=<DATABASE_URL with the database renamed to areca_e2e>
//   E2E_S3_BUCKET=areca-e2e
//   E2E_REDIS_URL=redis://localhost:6379/1   (separate rate-limit counters)
//
// It creates the database if needed, applies migrations, ensures the bucket,
// then runs `playwright test` with DATABASE_URL, S3_BUCKET, REDIS_URL,
// BETTER_AUTH_URL, APP_URL and PLAYWRIGHT_BASE_URL pointing at the isolated
// stack. Playwright starts `vite dev` on E2E_PORT (or reuses one already
// running there, which must have been started with the same variables).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createClient } from 'redis'

const cmsRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnvFile(file) {
  const values = {}
  if (!existsSync(file)) return values
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const fileEnv = {
  ...readEnvFile(join(cmsRoot, '.env')),
  ...readEnvFile(join(cmsRoot, '.env.local')),
}
const pick = (key) => process.env[key] ?? fileEnv[key]

const port = process.env.E2E_PORT ?? '3100'
const origin = `http://localhost:${port}`
const devDatabaseUrl = pick('DATABASE_URL')
let databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl) {
  if (!devDatabaseUrl) {
    throw new Error('Set E2E_DATABASE_URL or DATABASE_URL (apps/cms/.env.local).')
  }
  const url = new URL(devDatabaseUrl)
  url.pathname = '/areca_e2e'
  databaseUrl = url.toString()
}
if (devDatabaseUrl && new URL(devDatabaseUrl).pathname === new URL(databaseUrl).pathname) {
  throw new Error(
    `Refusing to run: the e2e database (${new URL(databaseUrl).pathname}) is your dev database.`,
  )
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  S3_BUCKET: process.env.E2E_S3_BUCKET ?? 'areca-e2e',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1',
  BETTER_AUTH_URL: origin,
  APP_URL: origin,
  PLAYWRIGHT_BASE_URL: origin,
  // No hot reloads while tests run (see vite.config.ts).
  VITE_DISABLE_HMR: 'true',
}

async function ensureDatabase() {
  const target = new URL(databaseUrl)
  const name = decodeURIComponent(target.pathname.slice(1))
  const admin = new URL(databaseUrl)
  admin.pathname = '/postgres'
  const client = new pg.Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [name])
    if (found.rowCount === 0) {
      await client.query(`create database "${name.replace(/"/g, '""')}"`)
      console.log(`[e2e] created database ${name}`)
    }
  } finally {
    await client.end()
  }
}

/**
 * The suite signs the same seeded users in from several workers, which can
 * trip the per-user mutation limit (60/min). Clear only the rate-limit
 * counters, and only in the e2e redis database.
 */
async function clearRateLimits() {
  const client = createClient({ url: env.REDIS_URL })
  client.on('error', () => {})
  try {
    await client.connect()
    let cleared = 0
    for await (const keys of client.scanIterator({ MATCH: 'areca:rate-limit:*', COUNT: 500 })) {
      const batch = Array.isArray(keys) ? keys : [keys]
      if (batch.length > 0) cleared += await client.del(batch)
    }
    if (cleared > 0) console.log(`[e2e] cleared ${cleared} rate-limit counter(s)`)
  } catch (error) {
    console.warn(`[e2e] could not clear rate limits: ${error.message}`)
  } finally {
    await client.quit().catch(() => {})
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: cmsRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await ensureDatabase()
await clearRateLimits()
run('pnpm', ['exec', 'drizzle-kit', 'migrate'])
run('pnpm', ['-s', 's3:init'])
console.log(`[e2e] isolated stack: ${origin} · db ${new URL(databaseUrl).pathname.slice(1)} · bucket ${env.S3_BUCKET} · ${env.REDIS_URL}`)
run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)])
