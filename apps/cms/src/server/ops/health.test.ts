import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  markLoopsStarted,
  markLoopsStopped,
  recordTick,
  resetHeartbeatsForTest,
} from './heartbeat'
import type { Backlog } from './backlog'
import { evaluateQueue, runReadinessChecks, withTimeout } from './health'
import type { QueueStats, ReadinessDeps } from './health'

const emptyQueue: QueueStats = {
  queued: 0,
  oldestQueuedAgeSeconds: null,
  active: 0,
  expiredLeases: 0,
  oldestExpiredLeaseSeconds: null,
}

const emptyBacklog: Backlog = {
  mailPending: 0,
  mailOldestPendingAgeSeconds: null,
  mailExpiredLeases: 0,
  notificationEventsPending: 0,
  notificationEventsOldestPendingAgeSeconds: null,
  storageDeletionsPaused: 0,
  schedulesExhausted: 0,
}

const healthy = (over: ReadinessDeps = {}): ReadinessDeps => ({
  timeoutMs: 200,
  maxQueueAgeSeconds: 900,
  maxTickAgeSeconds: 300,
  checkDb: async () => {},
  checkStorage: async () => {},
  checkRedis: async () => {},
  queueStats: async () => emptyQueue,
  backlog: async () => emptyBacklog,
  ...over,
})

describe('readiness', () => {
  beforeEach(() => resetHeartbeatsForTest())
  afterEach(() => markLoopsStopped())

  it('is ok when everything is healthy (worker disabled)', async () => {
    const report = await runReadinessChecks(healthy())
    expect(report.ok).toBe(true)
    expect(Object.keys(report.checks).sort()).toEqual([
      'db',
      'loops',
      'mail',
      'queue',
      'redis',
      'storage',
      'worker',
    ])
    expect(report.checks.worker.detail?.enabled).toBe(false)
    expect(report.degraded).toBe(false)
  })

  it('degrades, without failing, when mail has waited more than 15 minutes', async () => {
    const report = await runReadinessChecks(
      healthy({
        backlog: async () => ({
          mailPending: 2,
          mailOldestPendingAgeSeconds: 16 * 60,
          mailExpiredLeases: 0,
          notificationEventsPending: 0,
          notificationEventsOldestPendingAgeSeconds: null,
          storageDeletionsPaused: 0,
          schedulesExhausted: 0,
        }),
      }),
    )
    expect(report.ok).toBe(true)
    expect(report.degraded).toBe(true)
    expect(report.checks.mail).toMatchObject({
      ok: true,
      degraded: true,
      detail: { pending: 2, oldestPendingAgeSeconds: 960 },
    })
  })

  it('degrades when a worker loop has not succeeded in five of its intervals', async () => {
    markLoopsStarted(Date.now() - 60_000)
    // The mail loop runs every 5 s, so 25 s without a success is stale.
    // Every other loop has had a success recently enough.
    const report = await runReadinessChecks(healthy())
    expect(report.checks.loops).toMatchObject({ ok: true, degraded: true })
    expect(report.checks.loops.reason).toContain('mail')
    expect(report.ok).toBe(true)
  })

  it('fails when the database is down, with a redacted short reason', async () => {
    const report = await runReadinessChecks(
      healthy({
        checkDb: async () => {
          throw new Error(
            'connect ECONNREFUSED postgres://u:pw123456@db:5432/x',
          )
        },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.checks.db.ok).toBe(false)
    expect(report.checks.db.reason).toContain('ECONNREFUSED')
    expect(JSON.stringify(report)).not.toContain('pw123456')
  })

  it('fails when storage is down', async () => {
    const report = await runReadinessChecks(
      healthy({
        checkStorage: async () => {
          throw Object.assign(new Error('boom'), { name: 'NoSuchBucket' })
        },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.checks.storage.reason).toContain('NoSuchBucket')
  })

  it('reports redis as degraded without failing readiness', async () => {
    const report = await runReadinessChecks(
      healthy({
        checkRedis: async () => {
          throw new Error('ECONNREFUSED')
        },
      }),
    )
    expect(report.ok).toBe(true)
    expect(report.checks.redis).toMatchObject({ ok: true, degraded: true })
  })

  it('never hangs: a stuck check times out', async () => {
    const started = Date.now()
    const report = await runReadinessChecks(
      healthy({ checkDb: () => new Promise(() => {}), timeoutMs: 50 }),
    )
    expect(Date.now() - started).toBeLessThan(1000)
    expect(report.ok).toBe(false)
    expect(report.checks.db.reason).toContain('timed out')
  })

  it('aborts the signal handed to storage on timeout', async () => {
    let aborted = false
    await runReadinessChecks(
      healthy({
        timeoutMs: 30,
        checkStorage: (signal) =>
          new Promise(() => {
            signal.addEventListener('abort', () => (aborted = true))
          }),
      }),
    )
    expect(aborted).toBe(true)
  })

  it('fails the queue check when the oldest queued job is too old', async () => {
    const report = await runReadinessChecks(
      healthy({
        queueStats: async () => ({
          ...emptyQueue,
          queued: 1,
          oldestQueuedAgeSeconds: 901,
        }),
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.checks.queue.ok).toBe(false)
    expect(report.checks.queue.reason).toContain('oldest queued job')
  })

  it('fails the queue check on long-expired leases', () => {
    const result = evaluateQueue(
      {
        ...emptyQueue,
        active: 1,
        expiredLeases: 1,
        oldestExpiredLeaseSeconds: 301,
      },
      { maxQueueAgeSeconds: 900, maxTickAgeSeconds: 300 },
    )
    expect(result.ok).toBe(false)
  })

  it('fails when the worker or scheduler stopped ticking while enabled', async () => {
    markLoopsStarted(1_000)
    recordTick('worker', 1_000)
    recordTick('scheduler', 1_000)
    const base = healthy({ now: () => 1_000 + 299_000 })
    expect((await runReadinessChecks(base)).ok).toBe(true)

    const stale = healthy({ now: () => 1_000 + 301_000 })
    const report = await runReadinessChecks(stale)
    expect(report.ok).toBe(false)
    expect(report.checks.worker.ok).toBe(false)
    expect(report.checks.queue.ok).toBe(false)
    expect(report.checks.queue.reason).toContain('scheduler')

    recordTick('worker', 1_000 + 300_000)
    recordTick('scheduler', 1_000 + 300_000)
    expect((await runReadinessChecks(stale)).ok).toBe(true)
  })

  it('withTimeout rejects after the deadline', async () => {
    await expect(withTimeout(() => new Promise(() => {}), 10)).rejects.toThrow(
      /timed out/,
    )
    await expect(withTimeout(async () => 7, 100)).resolves.toBe(7)
  })
})
