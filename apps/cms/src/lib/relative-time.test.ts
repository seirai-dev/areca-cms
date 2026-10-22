import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatRelativeTime } from './relative-time'

const NOW = new Date('2026-10-22T12:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the full date after a day by default', () => {
    const three = new Date(NOW.getTime() - 3 * DAY)
    expect(formatRelativeTime(three)).not.toMatch(/ago/)
  })

  it('says whole days when asked, inside the window', () => {
    const three = new Date(NOW.getTime() - 3 * DAY)
    expect(formatRelativeTime(three, { withinDays: 7 })).toBe('3 days ago')
  })

  it('falls back to the date past the window', () => {
    const ten = new Date(NOW.getTime() - 10 * DAY)
    expect(formatRelativeTime(ten, { withinDays: 7 })).not.toMatch(/ago/)
  })

  it('keeps hours inside a day, with or without the option', () => {
    const two = new Date(NOW.getTime() - 2 * HOUR)
    expect(formatRelativeTime(two)).toBe('2 hours ago')
    expect(formatRelativeTime(two, { withinDays: 7 })).toBe('2 hours ago')
  })
})
