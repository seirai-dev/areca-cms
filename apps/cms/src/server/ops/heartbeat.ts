/**
 * In-memory loop heartbeats. The worker loops stamp these so readiness and
 * metrics can tell a live loop from a wedged or dead one. State lives on
 * globalThis so dev HMR / duplicated bundles share it.
 *
 * Two clocks per loop: `tick` (the timer fired, so the event loop is alive)
 * and `success` (a run finished without error). A loop that ticks but never
 * succeeds is wedged or failing, and only `success` shows that.
 */
export type LoopName =
  | 'worker'
  | 'scheduler'
  | 'recovery'
  | 'cleanup'
  | 'mail'
  | 'notifications'
  | 'maintenance'

/** How often each loop is due to run. Readiness allows 5× this before degrading. */
export const LOOP_INTERVAL_SECONDS: Record<LoopName, number> = {
  worker: 3,
  scheduler: 15,
  recovery: 15,
  cleanup: 15,
  mail: 5,
  notifications: 5,
  maintenance: 60 * 60,
}

export const STALE_LOOP_MULTIPLIER = 5

type HeartbeatState = {
  /** Set when the loops were started; absent when WORKER_ENABLED=false. */
  startedAt?: number
  lastTick: Partial<Record<LoopName, number>>
  lastSuccess: Partial<Record<LoopName, number>>
}

const g = globalThis as typeof globalThis & {
  __arecaHeartbeat?: HeartbeatState
}

function state(): HeartbeatState {
  g.__arecaHeartbeat ??= { lastTick: {}, lastSuccess: {} }
  return g.__arecaHeartbeat
}

export function markLoopsStarted(now = Date.now()) {
  state().startedAt = now
}

export function markLoopsStopped() {
  const s = state()
  s.startedAt = undefined
  s.lastTick = {}
  s.lastSuccess = {}
}

export function recordTick(loop: LoopName, now = Date.now()) {
  state().lastTick[loop] = now
}

/** A run of `loop` finished without error. */
export function recordLoopSuccess(loop: LoopName, now = Date.now()) {
  state().lastSuccess[loop] = now
}

export function loopsEnabled() {
  return state().startedAt !== undefined
}

/**
 * Seconds since the loop last ticked. Before the first tick the age is
 * measured from start-up, so a freshly booted process gets a grace period.
 * Null when loops are not running in this process.
 */
export function tickAgeSeconds(
  loop: LoopName,
  now = Date.now(),
): number | null {
  const s = state()
  if (s.startedAt === undefined) return null
  const last = s.lastTick[loop] ?? s.startedAt
  return Math.max(0, (now - last) / 1000)
}

/** Seconds since the loop last succeeded; measured from start-up until it does. */
export function successAgeSeconds(
  loop: LoopName,
  now = Date.now(),
): number | null {
  const s = state()
  if (s.startedAt === undefined) return null
  const last = s.lastSuccess[loop] ?? s.startedAt
  return Math.max(0, (now - last) / 1000)
}

/** Loops whose last success is older than 5× their interval. Empty when loops are off. */
export function staleLoops(now = Date.now()): LoopName[] {
  if (!loopsEnabled()) return []
  return (Object.keys(LOOP_INTERVAL_SECONDS) as LoopName[]).filter((loop) => {
    const age = successAgeSeconds(loop, now) ?? 0
    return age > LOOP_INTERVAL_SECONDS[loop] * STALE_LOOP_MULTIPLIER
  })
}

export function resetHeartbeatsForTest() {
  g.__arecaHeartbeat = { lastTick: {}, lastSuccess: {} }
}
