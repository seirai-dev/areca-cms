import { describe, expect, it } from 'vitest'

import { isSessionNotFresh, orderSessions } from './sessions'

describe('isSessionNotFresh', () => {
  it('matches only the not-fresh code', () => {
    expect(isSessionNotFresh({ code: 'SESSION_NOT_FRESH', status: 403 })).toBe(
      true,
    )
    expect(isSessionNotFresh({ code: 'UNAUTHORIZED' })).toBe(false)
    expect(isSessionNotFresh(new Error('boom'))).toBe(false)
    expect(isSessionNotFresh(null)).toBe(false)
  })
})

describe('orderSessions', () => {
  it('puts this device first, then the most recently active', () => {
    const sessions = [
      { token: 'old', updatedAt: '2026-10-01T10:00:00Z' },
      { token: 'current', updatedAt: '2026-10-02T10:00:00Z' },
      { token: 'recent', updatedAt: '2026-10-20T10:00:00Z' },
    ]
    expect(orderSessions(sessions, 'current').map((s) => s.token)).toEqual([
      'current',
      'recent',
      'old',
    ])
  })

  it('does not mutate its input', () => {
    const sessions = [
      { token: 'a', updatedAt: '2026-10-01T10:00:00Z' },
      { token: 'b', updatedAt: '2026-10-02T10:00:00Z' },
    ]
    orderSessions(sessions, null)
    expect(sessions.map((s) => s.token)).toEqual(['a', 'b'])
  })
})
