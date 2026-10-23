import { describe, expect, it } from 'vitest'

import {
  failureStreak,
  healthWindowStart,
  invitationDeliveryPatch,
  nextStep,
  retryDelayMs,
} from './outbox-policy.ts'

const now = new Date('2026-10-21T10:00:00Z')

describe('retry schedule', () => {
  it('waits 1 minute after the first attempt and 5 minutes after the second', () => {
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(5 * 60_000)
  })

  it('retries a retryable failure until the third attempt, then gives up', () => {
    const retryable = { retryable: true }
    expect(nextStep(retryable, 1, now)).toEqual({
      retry: true,
      nextAttemptAt: new Date('2026-10-21T10:01:00Z'),
    })
    expect(nextStep(retryable, 2, now)).toEqual({
      retry: true,
      nextAttemptAt: new Date('2026-10-21T10:05:00Z'),
    })
    expect(nextStep(retryable, 3, now)).toEqual({ retry: false })
  })

  it('never retries a non-retryable failure', () => {
    expect(nextStep({ retryable: false }, 1, now)).toEqual({ retry: false })
  })
})

describe('invitation delivery patch', () => {
  it('a sent email clears the error and stamps the send time', () => {
    expect(invitationDeliveryPatch('sent', 'old error', now)).toEqual({
      deliveryStatus: 'sent',
      lastDeliveryError: null,
      lastSentAt: now,
    })
  })

  it('a queued or failed email keeps the readable reason', () => {
    expect(
      invitationDeliveryPatch('queued', 'Email queued reason', now),
    ).toEqual({
      deliveryStatus: 'queued',
      lastDeliveryError: 'Email queued reason',
    })
    expect(invitationDeliveryPatch('failed', 'Gave up', now)).toEqual({
      deliveryStatus: 'failed',
      lastDeliveryError: 'Gave up',
    })
  })
})

describe('healthWindowStart', () => {
  const early = new Date('2026-10-01T10:00:00Z')
  const late = new Date('2026-10-02T10:00:00Z')

  it('starts at the epoch when nothing was sent or changed', () => {
    expect(healthWindowStart(null, null).getTime()).toBe(0)
  })

  it('starts at the last success when settings are older', () => {
    expect(healthWindowStart(late, early)).toEqual(late)
  })

  it('starts fresh after the mail settings change', () => {
    expect(healthWindowStart(early, late)).toEqual(late)
  })
})

describe('failureStreak', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 12, minute))
  const failed = (minute: number, errorCode = 'timeout') => ({
    outcome: 'failed' as const,
    createdAt: at(minute),
    errorCode,
    errorParams: {},
  })
  const retrying = (minute: number) => ({
    outcome: 'retrying' as const,
    createdAt: at(minute),
    errorCode: 'connection_failed',
    errorParams: {},
  })
  const sent = (minute: number) => ({
    outcome: 'sent' as const,
    createdAt: at(minute),
    errorCode: null,
    errorParams: null,
  })

  it('counts retried attempts as failures, newest first, until a success', () => {
    const streak = failureStreak([
      retrying(3),
      retrying(2),
      failed(1),
      sent(0),
      failed(-1),
    ])
    expect(streak.consecutiveFailures).toBe(3)
    expect(streak.last).toEqual(retrying(3))
  })

  it('is zero when the newest attempt succeeded', () => {
    expect(failureStreak([sent(2), failed(1)])).toEqual({
      consecutiveFailures: 0,
      last: null,
    })
  })

  it('counts every failed attempt of one row, not one per row', () => {
    // Three attempts on the same email are three failures for the banner.
    expect(
      failureStreak([failed(3), failed(2), failed(1)]).consecutiveFailures,
    ).toBe(3)
  })
})
