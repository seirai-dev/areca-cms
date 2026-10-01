import { describe, expect, it } from 'vitest'

import { STEP_UP_WINDOW_MS, isFresh } from './step-up.ts'

const now = new Date('2026-10-01T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('isFresh', () => {
  it('accepts a session created inside the window', () => {
    expect(isFresh([ago(60_000)], now)).toBe(true)
  })

  it('accepts the exact boundary and rejects one millisecond past it', () => {
    expect(isFresh([ago(STEP_UP_WINDOW_MS)], now)).toBe(true)
    expect(isFresh([ago(STEP_UP_WINDOW_MS + 1)], now)).toBe(false)
  })

  it('is fresh when any timestamp is recent (re-verification marker)', () => {
    expect(isFresh([ago(60 * 60_000), ago(30_000)], now)).toBe(true)
  })

  it('ignores missing timestamps', () => {
    expect(isFresh([undefined, null], now)).toBe(false)
    expect(isFresh([], now)).toBe(false)
  })

  it('treats a timestamp slightly in the future (clock skew) as fresh', () => {
    expect(isFresh([new Date(now.getTime() + 5_000)], now)).toBe(true)
  })

  it('honours a custom window', () => {
    expect(isFresh([ago(5_000)], now, 1_000)).toBe(false)
  })

  it('defaults the window to ten minutes', () => {
    expect(STEP_UP_WINDOW_MS).toBe(10 * 60 * 1000)
  })
})
