import { createHash, timingSafeEqual } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { db } from '#/db'
import { poolStats } from '#/db/pool-registry'
import type { PoolStats } from '#/db/pool-registry'
import { env } from '#/env'
import { createLogger } from '#/server/log'
import type { BuildJobStatus, PublicationStatus } from '#/lib/types'

import { cachedReadinessChecks } from './health'
import type { CheckName, ReadinessReport } from './health'
import {
  LOOP_INTERVAL_SECONDS,
  loopsEnabled,
  successAgeSeconds,
  tickAgeSeconds,
} from './heartbeat'
import type { LoopName } from './heartbeat'
import { collectBacklog } from './backlog'
import type { Backlog } from './backlog'
import { sampleEventLoop } from './event-loop'
import type { EventLoopStats } from './event-loop'

const log = createLogger('metrics')

export const BUILD_JOB_STATUSES: BuildJobStatus[] = [
  'queued',
  'building',
  'validating',
  'deploying',
  'succeeded',
  'failed',
  'cancelled',
]
export const PUBLICATION_STATUSES: PublicationStatus[] = [
  'pending',
  'building',
  'demo',
  'live',
  'failed',
  'superseded',
  'rolled_back',
]
const ACTIVE: BuildJobStatus[] = ['building', 'validating', 'deploying']

export type MetricsSnapshot = {
  publicationFailuresTotal: number
  jobsByStatus: Partial<Record<string, number>>
  publicationsByStatus: Partial<Record<string, number>>
  oldestQueuedAgeSeconds: number | null
  scheduledOverdue: number
  workerEnabled: boolean
  workerTickAgeSeconds: number | null
  schedulerTickAgeSeconds: number | null
  /** Queue depths and paused work, see `backlog.ts`. */
  backlog: Backlog
  /** Seconds since each worker loop last finished a run; null when loops are off. */
  loopSuccessAgeSeconds: Record<LoopName, number | null>
  readiness: ReadinessReport
  uptimeSeconds: number
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number }
  /** Connection pools registered in this process, see `#/db/pool-registry`. */
  pools: PoolStats[]
  eventLoop: EventLoopStats
}

type Sample = { labels?: Record<string, string>; value: number }
type Family = {
  name: string
  help: string
  type: 'gauge' | 'counter'
  samples: Sample[]
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

function formatValue(value: number) {
  if (Number.isNaN(value)) return 'NaN'
  if (!Number.isFinite(value)) return value > 0 ? '+Inf' : '-Inf'
  return String(value)
}

/** Prometheus text exposition format (version 0.0.4). */
export function renderPrometheus(snapshot: MetricsSnapshot): string {
  const families: Family[] = []
  const gauge = (name: string, help: string, samples: Sample[]) => {
    if (samples.length) families.push({ name, help, type: 'gauge', samples })
  }

  gauge(
    'areca_build_jobs',
    'Build jobs by status.',
    BUILD_JOB_STATUSES.map((status) => ({
      labels: { status },
      value: snapshot.jobsByStatus[status] ?? 0,
    })),
  )
  gauge(
    'areca_build_jobs_oldest_queued_age_seconds',
    'Age of the oldest queued build job; 0 when the queue is empty.',
    [{ value: snapshot.oldestQueuedAgeSeconds ?? 0 }],
  )
  gauge(
    'areca_build_jobs_active',
    'Build jobs currently building, validating or deploying.',
    [
      {
        value: ACTIVE.reduce(
          (sum, status) => sum + (snapshot.jobsByStatus[status] ?? 0),
          0,
        ),
      },
    ],
  )
  families.push({
    name: 'areca_build_jobs_failed_total',
    help: 'Publication execution failures since metrics history began; retained after job deletion.',
    type: 'counter',
    samples: [{ value: snapshot.publicationFailuresTotal }],
  })
  gauge(
    'areca_build_jobs_failed_backlog',
    'Build jobs currently in failed status.',
    [{ value: snapshot.jobsByStatus.failed ?? 0 }],
  )
  gauge(
    'areca_publications',
    'Publications by status.',
    PUBLICATION_STATUSES.map((status) => ({
      labels: { status },
      value: snapshot.publicationsByStatus[status] ?? 0,
    })),
  )
  gauge(
    'areca_scheduled_entries_overdue',
    'Scheduled entries whose publish time has passed but are not yet published.',
    [{ value: snapshot.scheduledOverdue }],
  )
  gauge(
    'areca_worker_enabled',
    '1 when the publishing worker loops run in this process.',
    [{ value: snapshot.workerEnabled ? 1 : 0 }],
  )
  if (snapshot.workerTickAgeSeconds != null) {
    gauge(
      'areca_worker_last_tick_age_seconds',
      'Seconds since the worker loop last ticked.',
      [{ value: snapshot.workerTickAgeSeconds }],
    )
  }
  if (snapshot.schedulerTickAgeSeconds != null) {
    gauge(
      'areca_scheduler_last_tick_age_seconds',
      'Seconds since the scheduler last completed a tick.',
      [{ value: snapshot.schedulerTickAgeSeconds }],
    )
  }
  const checkNames = Object.keys(snapshot.readiness.checks) as CheckName[]
  gauge(
    'areca_readiness_check_up',
    'Readiness check result (1 up, 0 down or degraded).',
    checkNames.map((name) => {
      const check = snapshot.readiness.checks[name]
      return {
        labels: { check: name },
        value: check.ok && !check.degraded ? 1 : 0,
      }
    }),
  )
  gauge('areca_mail_pending', 'Emails queued and waiting to send.', [
    { value: snapshot.backlog.mailPending },
  ])
  gauge(
    'areca_mail_oldest_pending_age_seconds',
    'Age of the oldest queued email, 0 when none.',
    [{ value: snapshot.backlog.mailOldestPendingAgeSeconds ?? 0 }],
  )
  gauge(
    'areca_mail_expired_leases',
    'Emails whose sender lease lapsed and that no one has reclaimed yet.',
    [{ value: snapshot.backlog.mailExpiredLeases }],
  )
  gauge(
    'areca_notification_events_pending',
    'Release notices waiting to be delivered.',
    [{ value: snapshot.backlog.notificationEventsPending }],
  )
  gauge(
    'areca_notification_events_oldest_pending_age_seconds',
    'Age of the oldest pending release notice, 0 when none.',
    [
      {
        value: snapshot.backlog.notificationEventsOldestPendingAgeSeconds ?? 0,
      },
    ],
  )
  gauge(
    'areca_storage_deletions_paused',
    'Storage deletions paused after four failed attempts.',
    [{ value: snapshot.backlog.storageDeletionsPaused }],
  )
  gauge(
    'areca_schedules_exhausted',
    'Scheduled publications stopped after four failed attempts.',
    [{ value: snapshot.backlog.schedulesExhausted }],
  )
  gauge(
    'areca_loop_success_age_seconds',
    'Seconds since each worker loop last finished a run without error.',
    Object.entries(snapshot.loopSuccessAgeSeconds).flatMap(([loop, age]) =>
      age == null ? [] : [{ labels: { loop }, value: age }],
    ),
  )
  gauge('areca_ready', '1 when /api/health/ready would return 200.', [
    { value: snapshot.readiness.ok ? 1 : 0 },
  ])
  gauge('areca_process_uptime_seconds', 'Process uptime.', [
    { value: snapshot.uptimeSeconds },
  ])
  gauge('areca_process_memory_bytes', 'Process memory by kind.', [
    { labels: { kind: 'rss' }, value: snapshot.memory.rss },
    { labels: { kind: 'heap_used' }, value: snapshot.memory.heapUsed },
    { labels: { kind: 'heap_total' }, value: snapshot.memory.heapTotal },
    { labels: { kind: 'external' }, value: snapshot.memory.external },
  ])
  gauge(
    'areca_db_pool_connections',
    'PostgreSQL connections per pool: total open and idle.',
    snapshot.pools.flatMap((pool) => [
      { labels: { pool: pool.label, state: 'total' }, value: pool.total },
      { labels: { pool: pool.label, state: 'idle' }, value: pool.idle },
    ]),
  )
  gauge(
    'areca_db_pool_waiting',
    'Requests waiting for a pooled PostgreSQL connection.',
    snapshot.pools.map((pool) => ({
      labels: { pool: pool.label },
      value: pool.waiting,
    })),
  )
  gauge(
    'areca_db_pool_max_connections',
    'Configured maximum connections per pool.',
    snapshot.pools.map((pool) => ({
      labels: { pool: pool.label },
      value: pool.max,
    })),
  )
  gauge(
    'areca_event_loop_utilization',
    'Share of time the event loop was busy since the previous scrape, 0 to 1.',
    [{ value: snapshot.eventLoop.utilization }],
  )
  if (snapshot.eventLoop.delaySeconds) {
    const { p50, p99, max } = snapshot.eventLoop.delaySeconds
    gauge(
      'areca_event_loop_delay_seconds',
      'Event loop delay since the previous scrape (sampled every 20ms).',
      [
        { labels: { stat: 'p50' }, value: p50 },
        { labels: { stat: 'p99' }, value: p99 },
        { labels: { stat: 'max' }, value: max },
      ],
    )
  }

  const lines: string[] = []
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${family.help}`)
    lines.push(`# TYPE ${family.name} ${family.type}`)
    for (const sample of family.samples) {
      const labels = sample.labels
        ? `{${Object.entries(sample.labels)
            .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
            .join(',')}}`
        : ''
      lines.push(`${family.name}${labels} ${formatValue(sample.value)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

export async function collectMetrics(
  readiness?: ReadinessReport,
): Promise<MetricsSnapshot> {
  // Sampled before any await so the window covers only this process's
  // event loop since the previous scrape.
  const eventLoop = sampleEventLoop()
  const [jobs, pubs, overdue, failures, report, backlog] = await Promise.all([
    db.execute<{ status: string; n: string; oldest: string | null }>(sql`
      select status, count(*) as n,
        extract(epoch from now() - min(created_at)) as oldest
      from build_job group by status`),
    db.execute<{ status: string; n: string }>(
      sql`select status, count(*) as n from publication group by status`,
    ),
    db.execute<{ n: string }>(
      sql`select count(*) as n from entry where status = 'scheduled' and scheduled_at <= now()`,
    ),
    db.execute<{ value: string }>(
      sql`select value from ops_counter where name = 'publication_failures'`,
    ),
    readiness ?? cachedReadinessChecks(),
    collectBacklog(),
  ])
  const jobsByStatus: Record<string, number> = {}
  let oldestQueued: number | null = null
  for (const row of jobs.rows) {
    jobsByStatus[row.status] = Number(row.n)
    if (row.status === 'queued' && row.oldest != null) {
      oldestQueued = Number(row.oldest)
    }
  }
  const publicationsByStatus: Record<string, number> = {}
  for (const row of pubs.rows) publicationsByStatus[row.status] = Number(row.n)
  const mem = process.memoryUsage()
  return {
    publicationFailuresTotal: Number(failures.rows[0]?.value ?? 0),
    jobsByStatus,
    publicationsByStatus,
    oldestQueuedAgeSeconds: oldestQueued,
    scheduledOverdue: Number(overdue.rows[0]?.n ?? 0),
    workerEnabled: loopsEnabled(),
    workerTickAgeSeconds: tickAgeSeconds('worker'),
    schedulerTickAgeSeconds: tickAgeSeconds('scheduler'),
    backlog,
    loopSuccessAgeSeconds: Object.fromEntries(
      (Object.keys(LOOP_INTERVAL_SECONDS) as LoopName[]).map((loop) => [
        loop,
        successAgeSeconds(loop),
      ]),
    ) as Record<LoopName, number | null>,
    readiness: report,
    uptimeSeconds: process.uptime(),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
    pools: poolStats(),
    eventLoop,
  }
}

/** Constant-time bearer comparison (digests make lengths equal). */
export function tokenMatches(provided: string, expected: string) {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export type MetricsDeps = {
  token?: string | undefined
  collect?: () => Promise<MetricsSnapshot>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function handleMetricsRequest(
  request: Request,
  deps: MetricsDeps = {},
) {
  const token = 'token' in deps ? deps.token : env.METRICS_TOKEN
  if (!token)
    return new Response('Not found', { status: 404, headers: NO_STORE })

  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match || !tokenMatches(match[1].trim(), token)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { ...NO_STORE, 'WWW-Authenticate': 'Bearer' },
    })
  }

  try {
    const body = renderPrometheus(await (deps.collect ?? collectMetrics)())
    return new Response(body, {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    })
  } catch (error) {
    log.error('metrics collection failed', { err: error })
    return new Response('Metrics unavailable', {
      status: 503,
      headers: NO_STORE,
    })
  }
}
