import { describe, expect, it } from 'vitest'

import {
  TWO_FACTOR_MANAGEMENT_PATHS,
  assertPasswordlessFresh,
} from './passwordless-two-factor.ts'

const now = new Date('2026-10-01T12:00:00Z')
const ago = (min: number) => new Date(now.getTime() - min * 60_000)

describe('TWO_FACTOR_MANAGEMENT_PATHS', () => {
  it('guards the endpoint that reveals the TOTP secret', () => {
    expect(TWO_FACTOR_MANAGEMENT_PATHS.has('/two-factor/get-totp-uri')).toBe(
      true,
    )
  })
})

describe('assertPasswordlessFresh', () => {
  it('never blocks users who have a password', () => {
    expect(() =>
      assertPasswordlessFresh(
        { hasPassword: true, sessionCreatedAt: ago(600) },
        now,
      ),
    ).not.toThrow()
  })
  it('allows a passwordless user with a session under ten minutes old', () => {
    expect(() =>
      assertPasswordlessFresh(
        { hasPassword: false, sessionCreatedAt: ago(9) },
        now,
      ),
    ).not.toThrow()
  })
  it('refuses a stale passwordless session with REAUTH_REQUIRED', () => {
    expect(() =>
      assertPasswordlessFresh(
        { hasPassword: false, sessionCreatedAt: ago(11) },
        now,
      ),
    ).toThrow(/REAUTH_REQUIRED/)
  })
})
