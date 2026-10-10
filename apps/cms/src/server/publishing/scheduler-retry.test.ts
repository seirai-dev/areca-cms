import { describe, expect, it } from 'vitest'
import { nextSchedulerAttempt, scheduleFingerprint } from './scheduler'

describe('scheduled release retry policy', () => {
  it('allows three retries at one, five and fifteen minutes, then pauses', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    expect(
      [1, 2, 3].map(
        (n) => nextSchedulerAttempt(n, now)!.getTime() - now.getTime(),
      ),
    ).toEqual([60_000, 300_000, 900_000])
    expect(nextSchedulerAttempt(4, now)).toBeNull()
  })
  it('keeps the cycle stable across row order and changes it for a new approval', () => {
    const rows = [
      { id: 'a', scheduledVersion: 'v1' },
      { id: 'b', scheduledVersion: 'v2' },
    ]
    expect(scheduleFingerprint(rows)).toBe(
      scheduleFingerprint([...rows].reverse()),
    )
    expect(scheduleFingerprint(rows)).not.toBe(
      scheduleFingerprint([{ ...rows[0], scheduledVersion: 'v3' }, rows[1]]),
    )
  })
})
