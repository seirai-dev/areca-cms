/**
 * In-memory loop heartbeats. The worker and the scheduler stamp these so
 * readiness and metrics can tell a live loop from a wedged or dead one.
 * State lives on globalThis so dev HMR / duplicated bundles share it.
 */
export type LoopName = 'worker' | 'scheduler'

type HeartbeatState = {
  /** Set when the loops were started; absent when WORKER_ENABLED=false. */
  startedAt?: number
  lastTick: Partial<Record<LoopName, number>>
}

const g = globalThis as typeof globalThis & {
  __arecaHeartbeat?: HeartbeatState
}

function state(): HeartbeatState {
  g.__arecaHeartbeat ??= { lastTick: {} }
  return g.__arecaHeartbeat
}

export function markLoopsStarted(now = Date.now()) {
  state().startedAt = now
}

export function markLoopsStopped() {
  const s = state()
  s.startedAt = undefined
  s.lastTick = {}
}

export function recordTick(loop: LoopName, now = Date.now()) {
  state().lastTick[loop] = now
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

export function resetHeartbeatsForTest() {
  g.__arecaHeartbeat = { lastTick: {} }
}
