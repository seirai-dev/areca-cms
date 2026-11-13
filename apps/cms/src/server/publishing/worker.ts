import { env } from '#/env'
import type { buildJob } from '#/db/schema'
import { drainStorageObjectDeletions } from '#/server/assets/storage-cleanup'
import { cleanupOutbox, processOutbox } from '#/server/mail/outbox'
import { cleanupNotifications } from '#/server/notifications/notify'
import { processPublicationEvents } from '#/server/notifications/publication-events'
import { autoRetryPausedJobs } from '#/server/ops/paused-jobs'
import { runRetention } from '#/server/ops/retention'
import {
  markLoopsStarted,
  markLoopsStopped,
  recordLoopSuccess,
  recordTick,
} from '#/server/ops/heartbeat'
import type { LoopName } from '#/server/ops/heartbeat'
import { createLogger } from '#/server/log'

import { claimNextJob } from './job-claim.ts'
import { processJob, recoverStaleJobs } from './job-run.ts'
import { runSchedulerTick } from './scheduler.ts'
import { installShutdownHandlers } from './shutdown.ts'

const logger = createLogger('worker')

const MAIL_INTERVAL_MS = 5000

type WorkerState = {
  /** Every loop tick still running. Shutdown waits on these, bounded. */
  inFlight: Set<Promise<unknown>>
  /** Aborted when the drain deadline passes: stop and leave rows for recovery. */
  abort?: AbortController
  /** Clears each loop's timer. */
  stops: Array<() => void>
  pool?: JobPool
}

const g = globalThis as typeof globalThis & {
  __arecaWorker?: WorkerState
}

export type JobPool = {
  /** Claims jobs until the concurrency cap is reached or the queue is empty. */
  fill: () => Promise<void>
  inFlight: () => number
  /** Stops claiming and waits (bounded) for running jobs. True if all finished. */
  drain: (timeoutMs?: number) => Promise<boolean>
}

/**
 * Runs claimed jobs as tracked in-flight promises. `fill` only awaits claims,
 * never a job, so a slow deployment for one site cannot delay claiming work for
 * other sites. Per-site serialization stays in the database (claim SQL,
 * partial unique indexes, leases).
 */
export function createJobPool({
  concurrency,
  claim,
  run,
}: {
  concurrency: number
  claim: () => Promise<typeof buildJob.$inferSelect | null>
  run: (job: typeof buildJob.$inferSelect) => Promise<unknown>
}): JobPool {
  const running = new Set<Promise<void>>()
  let filling: Promise<void> | null = null
  let stopped = false

  const fillOnce = async () => {
    while (!stopped && running.size < concurrency) {
      let job: typeof buildJob.$inferSelect | null
      try {
        job = await claim()
      } catch (error) {
        logger.error('claiming job failed', { err: error })
        return
      }
      if (!job) return
      const task: Promise<void> = Promise.resolve()
        .then(async () => {
          await run(job)
        })
        .catch((error) =>
          logger.error('job run failed', { jobId: job.id, err: error }),
        )
        .finally(() => {
          running.delete(task)
          // A slot freed up: pick up queued work without waiting for the timer.
          void fill()
        })
      running.add(task)
    }
  }
  const fill = () => {
    filling ??= fillOnce().finally(() => {
      filling = null
    })
    return filling
  }

  return {
    fill,
    inFlight: () => running.size,
    async drain(timeoutMs = 30_000) {
      stopped = true
      const result = await raceDeadline(
        (async () => {
          // A claim already in progress can add a task after stop. Include
          // that task before deciding the pool has finished draining.
          await filling
          await Promise.allSettled([...running])
          return 'done' as const
        })(),
        timeoutMs,
      )
      return result === 'done'
    },
  }
}

export type WorkerLoopDeps = {
  /** Claims queued jobs and starts them; must return without awaiting them. */
  processJobs: () => Promise<unknown>
  recover: () => Promise<unknown>
  /** Enqueues due scheduled publications. */
  schedule: () => Promise<unknown>
  /** Retries durable storage cleanup independently of releases. */
  cleanup?: () => Promise<unknown>
  /** Sends due emails from the outbox, every 5 s. */
  mail?: () => Promise<unknown>
  /** Delivers queued release notifications, every 5 s. */
  notificationEvents?: () => Promise<unknown>
  /** Deletes outbox rows past retention, hourly. */
  mailCleanup?: () => Promise<unknown>
}

/**
 * Independent timers, each with its own in-flight guard, so a slow
 * deployment (up to DEPLOY_TIMEOUT_MS) never delays recovery or the
 * scheduling of due entries for other sites:
 * - jobs: claims and runs queued jobs
 * - recovery: fails jobs whose lease expired
 * - scheduler: turns due scheduled entries into publications
 * - cleanup: retries durable storage object deletions
 * - mail: sends due outbox emails; mailCleanup: prunes old outbox rows
 */
export function startWorkerLoops(
  deps: WorkerLoopDeps,
  {
    intervalMs = 3000,
    schedulerIntervalMs = Math.min(intervalMs, 15_000),
  }: { intervalMs?: number; schedulerIntervalMs?: number } = {},
): WorkerState {
  markLoopsStarted()
  const state: WorkerState = { inFlight: new Set(), stops: [] }
  /**
   * Records each run's promise in `inFlight` until it settles, so shutdown can
   * wait for it. A run that resolves also stamps the loop's success clock,
   * which readiness and metrics read.
   */
  const track =
    (loop: LoopName, run: () => Promise<unknown>) => (): Promise<unknown> => {
      const promise = run()
      state.inFlight.add(promise)
      const done = () => {
        state.inFlight.delete(promise)
      }
      promise.then(() => {
        recordLoopSuccess(loop)
        done()
      }, done)
      return promise
    }
  /** setInterval that skips a tick while the previous run is still going. */
  const loop = (
    run: () => Promise<unknown>,
    everyMs: number,
    errorLabel: string,
    onFire?: () => void,
  ) => {
    let busy = false
    const tick = (work = run) => {
      if (busy) return
      busy = true
      void work()
        .catch((error) => logger.error(errorLabel, { err: error }))
        .finally(() => {
          busy = false
        })
    }
    const timer = setInterval(() => {
      onFire?.()
      tick()
    }, everyMs)
    state.stops.push(() => clearInterval(timer))
    return tick
  }

  const recover = track('recovery', deps.recover)
  const processJobs = track('worker', deps.processJobs)
  loop(recover, Math.min(intervalMs, 15_000), 'periodic recovery failed')
  // The timer firing proves the event loop is alive even while a long
  // deployment keeps the previous tick in flight.
  const jobs = loop(processJobs, intervalMs, 'worker tick failed', () =>
    recordTick('worker'),
  )
  const schedule = track('scheduler', deps.schedule)
  const scheduler = loop(
    () => schedule().then(() => recordTick('scheduler')),
    schedulerIntervalMs,
    'scheduler tick failed',
  )
  if (deps.cleanup)
    loop(track('cleanup', deps.cleanup), 15_000, 'storage cleanup failed')()
  if (deps.notificationEvents)
    loop(
      track('notifications', deps.notificationEvents),
      MAIL_INTERVAL_MS,
      'notification events tick failed',
    )
  if (deps.mail)
    loop(track('mail', deps.mail), MAIL_INTERVAL_MS, 'mail outbox tick failed')
  if (deps.mailCleanup)
    loop(
      track('maintenance', deps.mailCleanup),
      60 * 60 * 1000,
      'mail cleanup failed',
    )()

  // Boot: recover once, then start processing and scheduling immediately.
  jobs(() =>
    recover()
      .catch((error) =>
        logger.error('stale job recovery failed', { err: error }),
      )
      .finally(() => recordTick('worker'))
      .then(processJobs),
  )
  scheduler()
  return state
}

export function startWorker({
  intervalMs = 3000,
}: { intervalMs?: number } = {}) {
  if (!env.WORKER_ENABLED) return
  if (g.__arecaWorker) return g.__arecaWorker

  const workerPool = createJobPool({
    concurrency: env.WORKER_CONCURRENCY,
    claim: claimNextJob,
    run: (job) => processJob(job),
  })
  logger.info('publishing worker started', {
    intervalMs,
    concurrency: env.WORKER_CONCURRENCY,
  })
  // Aborted only when the drain deadline passes. Loops check it between items.
  const abort = new AbortController()
  const state = startWorkerLoops(
    {
      processJobs: workerPool.fill,
      recover: () => recoverStaleJobs(),
      schedule: () => runSchedulerTick(),
      cleanup: () => drainStorageObjectDeletions(100, { signal: abort.signal }),
      mail: () => processOutbox({ signal: abort.signal }),
      notificationEvents: () =>
        processPublicationEvents({ signal: abort.signal }),
      // Hourly maintenance: prune old rows, then retry paused work.
      mailCleanup: () =>
        Promise.all([
          cleanupOutbox(),
          cleanupNotifications(),
          runRetention(),
          autoRetryPausedJobs(),
        ]),
    },
    { intervalMs },
  )
  state.pool = workerPool
  state.abort = abort
  g.__arecaWorker = state
  installShutdownHandlers({
    stop: () => stopWorker({ drainTimeoutMs: env.WORKER_DRAIN_TIMEOUT_MS }),
    exit: (code) => process.exit(code),
  })
  return state
}

/**
 * Stops the timers and stops claiming. Then waits up to `drainTimeoutMs` for
 * running deployments and every loop tick (mail, storage, notifications,
 * scheduler, recovery). At the deadline the abort signal is raised, so loops
 * stop at their next item, and S3 calls are cancelled. Everything left behind
 * keeps its lease or durable state, and the next process recovers it.
 */
export async function stopWorker({
  drainTimeoutMs = 30_000,
}: { drainTimeoutMs?: number } = {}) {
  const state = g.__arecaWorker
  if (!state) return true
  stopWorkerLoops(state)
  g.__arecaWorker = undefined
  return drainWorkerState(state, drainTimeoutMs)
}

/** Waits for a stopped worker's running work, bounded. See `stopWorker`. */
export async function drainWorkerState(
  state: WorkerState,
  drainTimeoutMs = 30_000,
) {
  const settled = Promise.all([
    state.pool?.drain(drainTimeoutMs) ?? Promise.resolve(true),
    Promise.allSettled([...state.inFlight]),
  ]).then(([poolDrained]) => poolDrained)
  const outcome = await raceDeadline(settled, drainTimeoutMs)
  if (outcome === 'timeout') {
    state.abort?.abort()
    logger.warn('worker stopped with work still in flight; aborting', {
      jobsInFlight: state.pool?.inFlight(),
      loopsInFlight: state.inFlight.size,
    })
    return false
  }
  if (!outcome) {
    logger.warn('worker stopped with jobs still in flight', {
      inFlight: state.pool?.inFlight(),
    })
  }
  return outcome
}

function raceDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

export function stopWorkerLoops(state: WorkerState) {
  for (const stop of state.stops) stop()
  markLoopsStopped()
}
