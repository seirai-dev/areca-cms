import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { sql } from 'drizzle-orm'
import { createClient } from 'redis'

import { db } from '#/db'
import { env } from '#/env'
import { createLogger, redactString, truncate } from '#/server/log'

import { loopsEnabled, tickAgeSeconds } from './heartbeat'

const log = createLogger('health')

export type CheckName = 'db' | 'storage' | 'redis' | 'worker' | 'queue'

export type CheckResult = {
  ok: boolean
  ms: number
  /** Redis fails open by design: reported, but does not fail readiness. */
  degraded?: boolean
  /** Short redacted reason; never a raw error object. */
  reason?: string
  /** Non-sensitive numbers useful to operators. */
  detail?: Record<string, number | string | boolean | null>
}

export type ReadinessReport = {
  ok: boolean
  checks: Record<CheckName, CheckResult>
}

export type ReadinessDeps = {
  timeoutMs?: number
  maxQueueAgeSeconds?: number
  maxTickAgeSeconds?: number
  checkDb?: () => Promise<void>
  checkStorage?: (signal: AbortSignal) => Promise<void>
  checkRedis?: () => Promise<void>
  queueStats?: () => Promise<QueueStats>
  now?: () => number
}

export type QueueStats = {
  queued: number
  /** Age of the oldest queued job in seconds, null when none queued. */
  oldestQueuedAgeSeconds: number | null
  active: number
  /** Active jobs whose lease has expired, and how long the oldest one has been expired. */
  expiredLeases: number
  oldestExpiredLeaseSeconds: number | null
}

class CheckTimeout extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`)
    this.name = 'CheckTimeout'
  }
}

/** Race a promise against a deadline; aborts via the signal when provided. */
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new CheckTimeout(ms))
    }, ms)
  })
  try {
    return await Promise.race([work(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}

function shortReason(error: unknown) {
  const record = error as { name?: string; code?: unknown } | null
  const name = record?.name && record.name !== 'Error' ? record.name : ''
  const code = typeof record?.code === 'string' ? record.code : ''
  const message = error instanceof Error ? error.message : String(error)
  const text = [name, code, redactString(message)].filter(Boolean).join(': ')
  return truncate(text, 160)
}

async function run(
  name: CheckName,
  fn: () => Promise<Omit<CheckResult, 'ms'> | void>,
): Promise<CheckResult> {
  const started = performance.now()
  try {
    const result = (await fn()) ?? { ok: true }
    return { ...result, ms: Math.round(performance.now() - started) }
  } catch (error) {
    log.warn('readiness check failed', { check: name, err: error })
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      reason: shortReason(error),
    }
  }
}

let s3Client: S3Client | undefined
function storageClient() {
  s3Client ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    maxAttempts: 1,
  })
  return s3Client
}

async function defaultCheckDb() {
  await db.execute(sql`select 1`)
}

async function defaultCheckStorage(signal: AbortSignal) {
  await storageClient().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), {
    abortSignal: signal,
  })
}

async function defaultCheckRedis() {
  const client = createClient({
    url: env.REDIS_URL,
    socket: { connectTimeout: 1_000, reconnectStrategy: false },
  })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.ping()
  } finally {
    client.destroy()
  }
}

export async function defaultQueueStats(): Promise<QueueStats> {
  const result = await db.execute<{
    queued: string
    oldest_queued: string | null
    active: string
    expired: string
    oldest_expired: string | null
  }>(sql`
    select
      count(*) filter (where status = 'queued') as queued,
      extract(epoch from now() - min(created_at) filter (where status = 'queued')) as oldest_queued,
      count(*) filter (where status in ('building','validating','deploying')) as active,
      count(*) filter (where status in ('building','validating','deploying') and lease_expires_at < now()) as expired,
      extract(epoch from now() - min(lease_expires_at) filter (where status in ('building','validating','deploying') and lease_expires_at < now())) as oldest_expired
    from build_job
    where status in ('queued','building','validating','deploying')
  `)
  const row = result.rows[0]
  return {
    queued: Number(row?.queued ?? 0),
    oldestQueuedAgeSeconds:
      row?.oldest_queued == null ? null : Number(row.oldest_queued),
    active: Number(row?.active ?? 0),
    expiredLeases: Number(row?.expired ?? 0),
    oldestExpiredLeaseSeconds:
      row?.oldest_expired == null ? null : Number(row.oldest_expired),
  }
}

/** Pure evaluation of queue health, exported for tests. */
export function evaluateQueue(
  stats: QueueStats,
  limits: { maxQueueAgeSeconds: number; maxTickAgeSeconds: number },
): Omit<CheckResult, 'ms'> {
  const detail = {
    queued: stats.queued,
    active: stats.active,
    oldestQueuedAgeSeconds:
      stats.oldestQueuedAgeSeconds == null
        ? null
        : Math.round(stats.oldestQueuedAgeSeconds),
    expiredLeases: stats.expiredLeases,
  }
  if (
    stats.oldestQueuedAgeSeconds != null &&
    stats.oldestQueuedAgeSeconds > limits.maxQueueAgeSeconds
  ) {
    return {
      ok: false,
      reason: `oldest queued job waiting ${Math.round(stats.oldestQueuedAgeSeconds)}s (limit ${limits.maxQueueAgeSeconds}s)`,
      detail,
    }
  }
  if (
    stats.oldestExpiredLeaseSeconds != null &&
    stats.oldestExpiredLeaseSeconds > limits.maxTickAgeSeconds
  ) {
    return {
      ok: false,
      reason: `job lease expired ${Math.round(stats.oldestExpiredLeaseSeconds)}s ago and not recovered`,
      detail,
    }
  }
  return { ok: true, detail }
}

export async function runReadinessChecks(
  deps: ReadinessDeps = {},
): Promise<ReadinessReport> {
  const timeoutMs = deps.timeoutMs ?? env.READINESS_TIMEOUT_MS
  const maxQueueAgeSeconds =
    deps.maxQueueAgeSeconds ?? env.READINESS_MAX_QUEUE_AGE_SECONDS
  const maxTickAgeSeconds =
    deps.maxTickAgeSeconds ?? env.READINESS_MAX_TICK_AGE_SECONDS
  const now = deps.now?.()

  const [dbResult, storage, redis, queue] = await Promise.all([
    run('db', async () => {
      await withTimeout(() => (deps.checkDb ?? defaultCheckDb)(), timeoutMs)
    }),
    run('storage', async () => {
      await withTimeout(
        (signal) => (deps.checkStorage ?? defaultCheckStorage)(signal),
        timeoutMs,
      )
    }),
    run('redis', async () => {
      try {
        await withTimeout(
          () => (deps.checkRedis ?? defaultCheckRedis)(),
          timeoutMs,
        )
      } catch (error) {
        // Rate limiting fails open, so Redis trouble degrades but never fails.
        return { ok: true, degraded: true, reason: shortReason(error) }
      }
    }),
    run('queue', async () => {
      const stats = await withTimeout(
        () => (deps.queueStats ?? defaultQueueStats)(),
        timeoutMs,
      )
      const evaluated = evaluateQueue(stats, {
        maxQueueAgeSeconds,
        maxTickAgeSeconds,
      })
      // The scheduler must keep ticking while the loops are enabled.
      const schedulerAge = tickAgeSeconds('scheduler', now)
      if (
        evaluated.ok &&
        schedulerAge != null &&
        schedulerAge > maxTickAgeSeconds
      ) {
        return {
          ok: false,
          reason: `scheduler has not ticked for ${Math.round(schedulerAge)}s`,
          detail: {
            ...evaluated.detail,
            schedulerAgeSeconds: Math.round(schedulerAge),
          },
        }
      }
      return {
        ...evaluated,
        detail: {
          ...evaluated.detail,
          schedulerAgeSeconds:
            schedulerAge == null ? null : Math.round(schedulerAge),
        },
      }
    }),
  ])

  const worker = await run(
    'worker',
    async (): Promise<Omit<CheckResult, 'ms'>> => {
      if (!loopsEnabled()) {
        return { ok: true, detail: { enabled: false } }
      }
      const age = tickAgeSeconds('worker', now) ?? 0
      if (age > maxTickAgeSeconds) {
        return {
          ok: false,
          reason: `worker has not ticked for ${Math.round(age)}s`,
          detail: { enabled: true, tickAgeSeconds: Math.round(age) },
        }
      }
      return {
        ok: true,
        detail: { enabled: true, tickAgeSeconds: Math.round(age) },
      }
    },
  )

  const checks = { db: dbResult, storage, redis, worker, queue }
  return {
    ok: Object.values(checks).every((check) => check.ok),
    checks,
  }
}
