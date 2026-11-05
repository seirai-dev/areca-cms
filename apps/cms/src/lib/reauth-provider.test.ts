import { describe, expect, it } from 'vitest'

import { reauthProviderFor } from './reauth-provider'

describe('reauthProviderFor', () => {
  const methods = {
    emailPassword: true,
    socials: ['github' as const, 'google' as const],
    sso: { providerId: 'microsoft' },
  }

  it('prefers the linked SSO provider', () => {
    expect(reauthProviderFor(['google', 'microsoft'], methods)).toEqual({
      kind: 'sso',
      providerId: 'microsoft',
    })
  })

  it('falls back to a linked social provider', () => {
    expect(reauthProviderFor(['credential', 'google'], methods)).toEqual({
      kind: 'social',
      provider: 'google',
    })
  })

  it('ignores linked providers that are switched off', () => {
    expect(
      reauthProviderFor(['microsoft', 'discord'], { ...methods, sso: null }),
    ).toBeNull()
  })
})
