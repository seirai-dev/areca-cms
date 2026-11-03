import { describe, expect, it } from 'vitest'

import {
  AUTOSAVE_DELAY,
  AUTOSAVE_MAX_WAIT,
  SCHEDULED_POLL_FAST,
  SCHEDULED_POLL_SLOW,
  SCHEDULED_POLL_WINDOW,
  autosaveDelay,
  scheduledPollInterval,
} from './editor-timing'

describe('autosaveDelay', () => {
  const t0 = 1_000_000

  it('saves 3s after a single change', () => {
    expect(AUTOSAVE_DELAY).toBe(3000)
    expect(autosaveDelay(t0, t0)).toBe(3000)
  })

  it('waits for the pause when the user stops early', () => {
    // Change at t0, typing stopped; a change at t0 + 2s restarts the 3s wait.
    expect(autosaveDelay(t0 + 2000, t0)).toBe(3000)
  })

  it('caps the wait at 10s after the first unsaved change while typing', () => {
    expect(AUTOSAVE_MAX_WAIT).toBe(10_000)
    // Typing every second: at 8s after the first change only 2s remain.
    expect(autosaveDelay(t0 + 8000, t0)).toBe(2000)
    // At 9.5s the cap leaves 500ms, not the full 3s.
    expect(autosaveDelay(t0 + 9500, t0)).toBe(500)
  })

  it('fires at once when the cap has passed', () => {
    expect(autosaveDelay(t0 + 10_000, t0)).toBe(0)
    expect(autosaveDelay(t0 + 25_000, t0)).toBe(0)
  })
})

describe('scheduledPollInterval', () => {
  const now = Date.parse('2026-11-03T12:00:00.000Z')
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString()

  it('polls fast within the last minute before the scheduled time', () => {
    expect(SCHEDULED_POLL_WINDOW).toBe(60_000)
    expect(scheduledPollInterval(at(30_000), now)).toBe(SCHEDULED_POLL_FAST)
    expect(scheduledPollInterval(at(60_000), now)).toBe(SCHEDULED_POLL_FAST)
  })

  it('polls fast once the time has passed, while the worker publishes', () => {
    expect(scheduledPollInterval(at(-1), now)).toBe(SCHEDULED_POLL_FAST)
    expect(scheduledPollInterval(at(-10 * 60_000), now)).toBe(
      SCHEDULED_POLL_FAST,
    )
  })

  it('polls slowly when the time is far away', () => {
    expect(SCHEDULED_POLL_SLOW).toBe(30_000)
    expect(scheduledPollInterval(at(10 * 60_000), now)).toBe(
      SCHEDULED_POLL_SLOW,
    )
  })

  it('wakes up no later than the start of the fast window', () => {
    // 90s away: the fast window starts in 30s, which is the next poll.
    expect(scheduledPollInterval(at(90_000), now)).toBe(30_000)
    // 75s away: the window starts in 15s, so the next poll is at 15s.
    expect(scheduledPollInterval(at(75_000), now)).toBe(15_000)
  })

  it('accepts a Date and falls back to fast for a missing or invalid time', () => {
    expect(scheduledPollInterval(new Date(now + 600_000), now)).toBe(
      SCHEDULED_POLL_SLOW,
    )
    expect(scheduledPollInterval(null, now)).toBe(SCHEDULED_POLL_FAST)
    expect(scheduledPollInterval(undefined, now)).toBe(SCHEDULED_POLL_FAST)
    expect(scheduledPollInterval('not a date', now)).toBe(SCHEDULED_POLL_FAST)
  })
})
