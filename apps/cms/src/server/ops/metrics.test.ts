import { describe, expect, it } from 'vitest'

import type { ReadinessReport } from './health'
import { handleMetricsRequest, renderPrometheus, tokenMatches } from './metrics'
import type { MetricsSnapshot } from './metrics'

const readiness: ReadinessReport = {
  ok: false,
  checks: {
    db: { ok: true, ms: 1 },
    storage: { ok: false, ms: 1, reason: 'x' },
    redis: { ok: true, degraded: true, ms: 1 },
    worker: { ok: true, ms: 0 },
    queue: { ok: true, ms: 1 },
    mail: { ok: true, ms: 1 },
    loops: { ok: true, ms: 1 },
  },
  degraded: false,
}

const snapshot: MetricsSnapshot = {
  publicationFailuresTotal: 12,
  jobsByStatus: {
    queued: 2,
    building: 1,
    deploying: 1,
    failed: 5,
    succeeded: 9,
  },
  publicationsByStatus: { live: 3, failed: 1 },
  oldestQueuedAgeSeconds: 42.5,
  scheduledOverdue: 4,
  workerEnabled: true,
  workerTickAgeSeconds: 1.5,
  schedulerTickAgeSeconds: 7,
  backlog: {
    mailPending: 3,
    mailOldestPendingAgeSeconds: 120,
    mailExpiredLeases: 1,
    notificationEventsPending: 6,
    notificationEventsOldestPendingAgeSeconds: 30,
    storageDeletionsPaused: 2,
    schedulesExhausted: 1,
  },
  loopSuccessAgeSeconds: {
    worker: 1,
    scheduler: 2,
    recovery: 3,
    cleanup: 4,
    mail: 4,
    notifications: null,
    maintenance: 5,
  },
  readiness,
  uptimeSeconds: 100,
  memory: { rss: 1, heapUsed: 2, heapTotal: 3, external: 4 },
  pools: [
    { label: 'main', total: 5, idle: 3, waiting: 2, max: 10 },
    { label: 'mcp', total: 1, idle: 1, waiting: 0, max: 4 },
  ],
  eventLoop: {
    utilization: 0.25,
    delaySeconds: { p50: 0.02, p99: 0.04, max: 0.075 },
  },
}

describe('renderPrometheus', () => {
  const text = renderPrometheus(snapshot)

  it('exposes mail, notification, paused work and per-loop success ages', () => {
    expect(text).toContain('areca_mail_pending 3')
    expect(text).toContain('areca_mail_oldest_pending_age_seconds 120')
    expect(text).toContain('areca_mail_expired_leases 1')
    expect(text).toContain('areca_notification_events_pending 6')
    expect(text).toContain('areca_storage_deletions_paused 2')
    expect(text).toContain('areca_schedules_exhausted 1')
    expect(text).toContain('areca_loop_success_age_seconds{loop="mail"} 4')
    expect(text).toContain(
      'areca_loop_success_age_seconds{loop="maintenance"} 5',
    )
    // A loop that has never succeeded is left out rather than reported as zero.
    expect(text).not.toContain('loop="notifications"')
  })

  it('emits HELP/TYPE headers and labelled samples', () => {
    expect(text).toContain('# HELP areca_build_jobs Build jobs by status.')
    expect(text).toContain('# TYPE areca_build_jobs gauge')
    expect(text).toContain('areca_build_jobs{status="queued"} 2')
    expect(text).toContain('areca_build_jobs{status="cancelled"} 0')
    expect(text).toContain('areca_build_jobs_failed_total 12')
    expect(text).toContain('# TYPE areca_build_jobs_failed_total counter')
    expect(text).toContain('# TYPE areca_build_jobs_failed_backlog gauge')
    expect(text).toContain('areca_build_jobs_failed_backlog 5')
    expect(text).toContain('areca_build_jobs_active 2')
    expect(text).toContain('areca_build_jobs_oldest_queued_age_seconds 42.5')
    expect(text).toContain('areca_publications{status="live"} 3')
    expect(text).toContain('areca_publications{status="rolled_back"} 0')
    expect(text).toContain('areca_scheduled_entries_overdue 4')
    expect(text).toContain('areca_worker_last_tick_age_seconds 1.5')
    expect(text).toContain('areca_scheduler_last_tick_age_seconds 7')
    expect(text).toContain('areca_readiness_check_up{check="db"} 1')
    expect(text).toContain('areca_readiness_check_up{check="storage"} 0')
    expect(text).toContain('areca_readiness_check_up{check="redis"} 0')
    expect(text).toContain('areca_ready 0')
    expect(text).toContain('areca_process_uptime_seconds 100')
    expect(text).toContain('areca_process_memory_bytes{kind="rss"} 1')
  })

  it('ends with a newline and every line is valid exposition syntax', () => {
    expect(text.endsWith('\n')).toBe(true)
    for (const line of text.trim().split('\n')) {
      expect(line).toMatch(
        /^(# (HELP|TYPE) [a-z_]+ .+|[a-z_]+(\{[a-z_]+="[^"]*"(,[a-z_]+="[^"]*")*\})? -?[0-9.]+(e[+-]?\d+)?)$/,
      )
    }
  })

  it('exposes pool connection states, waiting requests and configured max', () => {
    expect(text).toContain('# TYPE areca_db_pool_connections gauge')
    expect(text).toContain(
      'areca_db_pool_connections{pool="main",state="total"} 5',
    )
    expect(text).toContain(
      'areca_db_pool_connections{pool="main",state="idle"} 3',
    )
    expect(text).toContain(
      'areca_db_pool_connections{pool="mcp",state="idle"} 1',
    )
    expect(text).toContain('areca_db_pool_waiting{pool="main"} 2')
    expect(text).toContain('areca_db_pool_max_connections{pool="main"} 10')
    expect(text).toContain('areca_db_pool_max_connections{pool="mcp"} 4')
  })

  it('exposes event loop utilization and delay percentiles', () => {
    expect(text).toContain('# TYPE areca_event_loop_utilization gauge')
    expect(text).toContain('areca_event_loop_utilization 0.25')
    expect(text).toContain('areca_event_loop_delay_seconds{stat="p50"} 0.02')
    expect(text).toContain('areca_event_loop_delay_seconds{stat="p99"} 0.04')
    expect(text).toContain('areca_event_loop_delay_seconds{stat="max"} 0.075')
  })

  it('omits pool families without pools and delay without samples', () => {
    const out = renderPrometheus({
      ...snapshot,
      pools: [],
      eventLoop: { utilization: 0, delaySeconds: null },
    })
    expect(out).not.toContain('areca_db_pool_')
    expect(out).not.toContain('areca_event_loop_delay_seconds')
    expect(out).toContain('areca_event_loop_utilization 0')
  })

  it('omits tick ages when loops are disabled', () => {
    const out = renderPrometheus({
      ...snapshot,
      workerEnabled: false,
      workerTickAgeSeconds: null,
      schedulerTickAgeSeconds: null,
    })
    expect(out).not.toContain('areca_worker_last_tick_age_seconds')
    expect(out).toContain('areca_worker_enabled 0')
  })
})

describe('handleMetricsRequest', () => {
  const collect = async () => snapshot
  const req = (auth?: string) =>
    new Request('http://cms.test/api/metrics', {
      headers: auth ? { authorization: auth } : {},
    })
  const token = 'metrics-token-0123456789'

  it('is 404 when METRICS_TOKEN is unset', async () => {
    const res = await handleMetricsRequest(req(`Bearer ${token}`), {
      token: undefined,
      collect,
    })
    expect(res.status).toBe(404)
  })

  it('is 401 without or with a wrong bearer token', async () => {
    for (const header of [
      undefined,
      'Bearer nope',
      `Basic ${token}`,
      'Bearer ',
    ]) {
      const res = await handleMetricsRequest(req(header), { token, collect })
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
      expect(await res.text()).not.toContain('areca_')
    }
  })

  it('serves Prometheus text with the right token', async () => {
    const res = await handleMetricsRequest(req(`Bearer ${token}`), {
      token,
      collect,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toContain('areca_build_jobs{status="queued"} 2')
  })

  it('returns 503 without details when collection fails', async () => {
    const res = await handleMetricsRequest(req(`Bearer ${token}`), {
      token,
      collect: async () => {
        throw new Error('postgres://u:p@h/db exploded')
      },
    })
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('Metrics unavailable')
  })

  it('compares tokens in constant time-safe fashion', () => {
    expect(tokenMatches('a', 'a')).toBe(true)
    expect(tokenMatches('a', 'ab')).toBe(false)
  })
})

it('failure counter remains cumulative as the current failed backlog decreases', () => {
  const out = renderPrometheus({ ...snapshot, jobsByStatus: { failed: 0 } })
  expect(out).toContain('areca_build_jobs_failed_backlog 0')
  expect(out).toContain('areca_build_jobs_failed_total 12')
})
