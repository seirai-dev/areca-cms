import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

// Enabled at module load so the histogram covers the time between scrapes.
// The timer is unref'd by Node, so it never keeps a process or test run alive.
const delay = monitorEventLoopDelay({ resolution: 20 })
delay.enable()
let lastUtilization = performance.eventLoopUtilization()

export type EventLoopStats = {
  /** Share of time the loop was busy since the previous sample, 0 to 1. */
  utilization: number
  /** Delay percentiles since the previous sample; null when nothing was recorded. */
  delaySeconds: { p50: number; p99: number; max: number } | null
}

const NS_PER_SECOND = 1e9

/** Reads utilization and delay since the previous call, then resets both. */
export function sampleEventLoop(): EventLoopStats {
  const current = performance.eventLoopUtilization()
  const window = performance.eventLoopUtilization(current, lastUtilization)
  lastUtilization = current

  const delaySeconds =
    delay.count > 0
      ? {
          p50: delay.percentile(50) / NS_PER_SECOND,
          p99: delay.percentile(99) / NS_PER_SECOND,
          max: delay.max / NS_PER_SECOND,
        }
      : null
  delay.reset()

  return { utilization: window.utilization, delaySeconds }
}
