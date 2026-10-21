import { describe, expect, it } from 'vitest'

import type { Me } from '#/server/fn/me'

import {
  isVerifiedRedirect,
  needsEmailVerification,
  verifyEmailDismissedKey,
  withoutVerifiedParam,
} from './verify-email-logic'

function meWith(
  overrides: Partial<Me['user']> &
    Partial<Pick<Me, 'mfaEnrolmentRequired' | 'mfaVerificationRequired'>> = {},
): Me {
  const {
    mfaEnrolmentRequired = false,
    mfaVerificationRequired = false,
    ...user
  } = overrides
  return {
    user: {
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      isAgencyAdmin: false,
      twoFactorEnabled: false,
      emailVerified: false,
      locale: 'en',
      ...user,
    },
    mfaEnrolmentRequired,
    mfaVerificationRequired,
    memberships: [],
    sites: [],
    organizationCount: 0,
  }
}

describe('verifyEmailDismissedKey', () => {
  it('scopes the key to the account', () => {
    expect(verifyEmailDismissedKey('user-1')).toBe(
      'areca:verify-email-dismissed:user-1',
    )
    expect(verifyEmailDismissedKey('user-2')).not.toBe(
      verifyEmailDismissedKey('user-1'),
    )
  })
})

describe('needsEmailVerification', () => {
  it('prompts unverified people with no pending two-factor step', () => {
    expect(needsEmailVerification(meWith())).toBe(true)
  })

  it('stays quiet once verified or while two-factor comes first', () => {
    expect(needsEmailVerification(meWith({ emailVerified: true }))).toBe(false)
    expect(needsEmailVerification(meWith({ mfaEnrolmentRequired: true }))).toBe(
      false,
    )
    expect(
      needsEmailVerification(meWith({ mfaVerificationRequired: true })),
    ).toBe(false)
  })
})

describe('isVerifiedRedirect', () => {
  it('reads verified=1 only', () => {
    expect(isVerifiedRedirect('?verified=1')).toBe(true)
    expect(isVerifiedRedirect('?verified=0')).toBe(false)
    expect(isVerifiedRedirect('?other=1&verified=1')).toBe(true)
    expect(isVerifiedRedirect('')).toBe(false)
  })
})

describe('withoutVerifiedParam', () => {
  it('drops verified and keeps the rest', () => {
    expect(withoutVerifiedParam({ verified: '1', panel: 'activity' })).toEqual({
      panel: 'activity',
    })
  })
})
