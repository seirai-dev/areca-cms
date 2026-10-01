import { describe, expect, it } from 'vitest'

import {
  nextPollStart,
  scheduledTimes,
  shouldPollScheduled,
} from './scheduled-poll'

const NOW = Date.parse('2026-10-01T09:00:00Z')
const MIN = 60_000

describe('scheduledTimes', () => {
  it('keeps only rows that are still scheduled', () => {
    expect(
      scheduledTimes([
        { status: 'scheduled', scheduledAt: '2026-10-01T10:00:00Z' },
        { status: 'draft', scheduledAt: '2026-10-01T08:00:00Z' },
        { status: 'scheduled', scheduledAt: new Date('2026-10-01T09:30:00Z') },
        { status: 'scheduled', scheduledAt: null },
      ]),
    ).toEqual([
      Date.parse('2026-10-01T10:00:00Z'),
      Date.parse('2026-10-01T09:30:00Z'),
    ])
  })
})

describe('shouldPollScheduled', () => {
  it('does not poll without a scheduled entry', () => {
    expect(shouldPollScheduled([], NOW)).toBe(false)
  })
  it('does not poll while every time is more than a minute away', () => {
    expect(shouldPollScheduled([NOW + MIN + 1000, NOW + 60 * MIN], NOW)).toBe(
      false,
    )
  })
  it('polls from a minute before until a while after a time', () => {
    expect(shouldPollScheduled([NOW + MIN], NOW)).toBe(true)
    expect(shouldPollScheduled([NOW], NOW)).toBe(true)
    expect(shouldPollScheduled([NOW - 5 * MIN], NOW)).toBe(true)
  })
  it('gives up on an entry that stays scheduled long after its time', () => {
    expect(shouldPollScheduled([NOW - 11 * MIN], NOW)).toBe(false)
    expect(shouldPollScheduled([NOW - 11 * MIN, NOW + 30_000], NOW)).toBe(true)
  })
})

describe('nextPollStart', () => {
  it('is a minute before the next upcoming time', () => {
    expect(nextPollStart([NOW + 10 * MIN, NOW + 5 * MIN], NOW)).toBe(
      NOW + 4 * MIN,
    )
  })
  it('is null when every window has started', () => {
    expect(nextPollStart([NOW + 30_000, NOW - MIN], NOW)).toBeNull()
  })
})
