import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetHeartbeatsForTest, tickAgeSeconds } from '#/server/ops/heartbeat'

import { createJobPool, startWorkerLoops, stopWorkerLoops } from './worker.ts'

describe('worker loops', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetHeartbeatsForTest()
  })
  afterEach(() => vi.useRealTimers())

  it('keeps scheduling and recovering while a deployment is in flight', async () => {
    const never = new Promise<void>(() => {})
    const processJobs = vi.fn(() => never) // a deployment that never returns
    const schedule = vi.fn(async () => {})
    const recover = vi.fn(async () => {})
    const state = startWorkerLoops(
      { processJobs, schedule, recover },
      { intervalMs: 1000, schedulerIntervalMs: 1000 },
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(processJobs).toHaveBeenCalledTimes(1)
    const scheduledAtStart = schedule.mock.calls.length

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    // The job loop is stuck behind the slow deployment (in-flight guard)...
    expect(processJobs).toHaveBeenCalledTimes(1)
    // ...but due entries are still scheduled on every interval.
    expect(
      schedule.mock.calls.length - scheduledAtStart,
    ).toBeGreaterThanOrEqual(600)
    expect(recover.mock.calls.length).toBeGreaterThan(100)
    expect(tickAgeSeconds('scheduler')).toBeLessThan(2)
    expect(tickAgeSeconds('worker')).toBeLessThan(2)
    stopWorkerLoops(state)
  })

  it('runs storage cleanup independently while releases are stalled', async () => {
    const cleanup = vi.fn(async () => {})
    const state = startWorkerLoops(
      {
        processJobs: () => new Promise(() => {}),
        recover: async () => {},
        schedule: async () => {},
        cleanup,
      },
      { intervalMs: 1000 },
    )
    await vi.advanceTimersByTimeAsync(31_000)
    expect(cleanup).toHaveBeenCalledTimes(3)
    stopWorkerLoops(state)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cleanup).toHaveBeenCalledTimes(3)
  })

  it('does not overlap slow scheduler ticks', async () => {
    let running = 0
    let maxRunning = 0
    const schedule = vi.fn(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 5000))
      running--
    })
    const state = startWorkerLoops(
      { processJobs: async () => {}, schedule, recover: async () => {} },
      { intervalMs: 1000, schedulerIntervalMs: 1000 },
    )
    await vi.advanceTimersByTimeAsync(30_000)
    expect(maxRunning).toBe(1)
    stopWorkerLoops(state)
  })

  it('survives a failing scheduler and does not record a tick for it', async () => {
    const schedule = vi.fn(async () => {
      throw new Error('db down')
    })
    const state = startWorkerLoops(
      { processJobs: async () => {}, schedule, recover: async () => {} },
      { intervalMs: 1000, schedulerIntervalMs: 1000 },
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(schedule.mock.calls.length).toBeGreaterThan(3)
    // Never succeeded: age is measured from start-up and keeps growing.
    expect(tickAgeSeconds('scheduler')).toBeGreaterThanOrEqual(5)
    stopWorkerLoops(state)
    expect(tickAgeSeconds('scheduler')).toBeNull()
  })
})

describe('job pool', () => {
  const job = (id: string, siteId = id) =>
    ({ id, siteId, status: 'building' }) as never

  it('claims further jobs while earlier ones are still running, up to the cap', async () => {
    vi.useRealTimers()
    const queue = ['a', 'b', 'c'].map((id) => job(id))
    const started: string[] = []
    const finish = new Map<string, () => void>()
    const pool = createJobPool({
      concurrency: 2,
      claim: async () => queue.shift() ?? null,
      run: (j: { id: string }) =>
        new Promise<void>((resolve) => {
          started.push(j.id)
          finish.set(j.id, resolve)
        }),
    })
    await pool.fill()
    expect(started).toEqual(['a', 'b']) // c waits for a free slot
    expect(pool.inFlight()).toBe(2)

    finish.get('b')!()
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c']))
    expect(pool.inFlight()).toBe(2) // a (still running) + c
    finish.get('a')!()
    finish.get('c')!()
    expect(await pool.drain(1000)).toBe(true)
  })

  it('a failing job does not break the pool', async () => {
    const queue = [job('x'), job('y')]
    const ran: string[] = []
    const pool = createJobPool({
      concurrency: 1,
      claim: async () => queue.shift() ?? null,
      run: async (j: { id: string }) => {
        ran.push(j.id)
        if (j.id === 'x') throw new Error('boom')
      },
    })
    await pool.fill()
    await vi.waitFor(() => expect(ran).toEqual(['x', 'y']))
    expect(await pool.drain(1000)).toBe(true)
  })

  it('drains a job returned by an outstanding claim before reporting completion', async () => {
    vi.useRealTimers()
    let finishClaim!: (value: ReturnType<typeof job>) => void
    let finishRun!: () => void
    const claim = new Promise<ReturnType<typeof job>>((resolve) => {
      finishClaim = resolve
    })
    const run = new Promise<void>((resolve) => {
      finishRun = resolve
    })
    const pool = createJobPool({
      concurrency: 1,
      claim: () => claim,
      run: () => run,
    })
    void pool.fill()
    let drained = false
    const stopping = pool.drain(1000).then((result) => {
      drained = result
      return result
    })
    finishClaim(job('late'))
    await vi.waitFor(() => expect(pool.inFlight()).toBe(1))
    expect(drained).toBe(false)
    finishRun()
    expect(await stopping).toBe(true)
    expect(pool.inFlight()).toBe(0)
  })

  it('drain is bounded and stops claiming', async () => {
    const queue = [job('a'), job('b')]
    const claim = vi.fn(async () => queue.shift() ?? null)
    const pool = createJobPool({
      concurrency: 1,
      claim,
      run: () => new Promise<void>(() => {}), // never resolves
    })
    await pool.fill()
    const started = Date.now()
    expect(await pool.drain(50)).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
    await pool.fill()
    expect(claim).toHaveBeenCalledTimes(1)
  })
})
