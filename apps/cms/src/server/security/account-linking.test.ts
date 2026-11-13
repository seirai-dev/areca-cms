import { describe, expect, it } from 'vitest'

import { auth } from '#/lib/auth'

describe('account linking', () => {
  it('links a social or SSO sign-in only to an account verified locally', async () => {
    const { options } = await auth.$context
    const linking: {
      enabled?: boolean
      requireLocalEmailVerified?: boolean
      trustedProviders?: unknown
    } = options.account.accountLinking

    expect(linking.enabled).toBe(true)
    // Better Auth treats a missing value as true.
    expect(linking.requireLocalEmailVerified ?? true).toBe(true)
    expect(linking.trustedProviders ?? []).toEqual([])
  })
})
