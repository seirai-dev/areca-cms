import { createHash, timingSafeEqual } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { db } from '#/db'
import { env } from '#/env'
import { createLogger } from '#/server/log'
import type { BuildJobStatus, PublicationStatus } from '#/lib/types'

import { runReadinessChecks } from './health'
import type { CheckName, ReadinessReport } from './health'
import { loopsEnabled, tickAgeSeconds } from './heartbeat'

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
  jobsByStatus: Partial<Record<string, number>>
  publicationsByStatus: Partial<Record<string, number>>
  oldestQueuedAgeSeconds: number | null
  scheduledOverdue: number
  workerEnabled: boolean
  workerTickAgeSeconds: number | null
  schedulerTickAgeSeconds: number | null
  readiness: ReadinessReport
  uptimeSeconds: number
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number }
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
    help: 'Build jobs that ended in failed status (from database counts).',
    type: 'counter',
    samples: [{ value: snapshot.jobsByStatus.failed ?? 0 }],
  })
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
  const [jobs, pubs, overdue, report] = await Promise.all([
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
    readiness ?? runReadinessChecks(),
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
    jobsByStatus,
    publicationsByStatus,
    oldestQueuedAgeSeconds: oldestQueued,
    scheduledOverdue: Number(overdue.rows[0]?.n ?? 0),
    workerEnabled: loopsEnabled(),
    workerTickAgeSeconds: tickAgeSeconds('worker'),
    schedulerTickAgeSeconds: tickAgeSeconds('scheduler'),
    readiness: report,
    uptimeSeconds: process.uptime(),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
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
