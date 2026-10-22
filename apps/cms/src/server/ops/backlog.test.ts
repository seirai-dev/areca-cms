import { describe, expect, it } from 'vitest'

import { evaluateMailBacklog, MAIL_BACKLOG_DEGRADED_SECONDS } from './backlog'

describe('evaluateMailBacklog', () => {
  it('is fine when nothing is waiting', () => {
    expect(evaluateMailBacklog({ mailOldestPendingAgeSeconds: null })).toEqual({
      degraded: false,
    })
  })

  it('is fine while the oldest pending email is within 15 minutes', () => {
    expect(
      evaluateMailBacklog({
        mailOldestPendingAgeSeconds: MAIL_BACKLOG_DEGRADED_SECONDS,
      }).degraded,
    ).toBe(false)
  })

  it('degrades once the oldest pending email has waited past 15 minutes', () => {
    const verdict = evaluateMailBacklog({
      mailOldestPendingAgeSeconds: MAIL_BACKLOG_DEGRADED_SECONDS + 1,
    })
    expect(verdict.degraded).toBe(true)
    expect(verdict.reason).toContain('15 min')
  })
})
