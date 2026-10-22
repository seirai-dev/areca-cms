import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LOOP_INTERVAL_SECONDS,
  markLoopsStarted,
  markLoopsStopped,
  recordLoopSuccess,
  resetHeartbeatsForTest,
  staleLoops,
  successAgeSeconds,
} from './heartbeat'

describe('loop success clock', () => {
  beforeEach(() => resetHeartbeatsForTest())
  afterEach(() => markLoopsStopped())

  it('measures from start-up until a loop succeeds, then from its last success', () => {
    const start = 1_000_000
    markLoopsStarted(start)
    expect(successAgeSeconds('mail', start + 4_000)).toBe(4)

    recordLoopSuccess('mail', start + 4_000)
    expect(successAgeSeconds('mail', start + 9_000)).toBe(5)
  })

  it('is stale after five of its intervals without a success, and not at exactly five', () => {
    const start = 1_000_000
    markLoopsStarted(start)
    recordLoopSuccess('mail', start)
    const mailInterval = LOOP_INTERVAL_SECONDS.mail

    expect(staleLoops(start + mailInterval * 5 * 1000)).not.toContain('mail')
    expect(staleLoops(start + (mailInterval * 5 + 1) * 1000)).toContain('mail')
  })

  it('reports no stale loops when loops are not running in this process', () => {
    expect(staleLoops(Date.now() + 10 * 60 * 60_000)).toEqual([])
    expect(successAgeSeconds('mail')).toBeNull()
  })
})
