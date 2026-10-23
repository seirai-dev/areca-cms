import { describe, expect, it } from 'vitest'

import { orderSessions } from './sessions'

describe('orderSessions', () => {
  it('puts this device first, then the most recently active', () => {
    const sessions = [
      { id: 'old', current: false, updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'current', current: true, updatedAt: '2026-10-02T10:00:00Z' },
      { id: 'recent', current: false, updatedAt: '2026-10-20T10:00:00Z' },
    ]
    expect(orderSessions(sessions).map((s) => s.id)).toEqual([
      'current',
      'recent',
      'old',
    ])
  })

  it('does not mutate its input', () => {
    const sessions = [
      { id: 'a', current: false, updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'b', current: false, updatedAt: '2026-10-02T10:00:00Z' },
    ]
    orderSessions(sessions)
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })
})
