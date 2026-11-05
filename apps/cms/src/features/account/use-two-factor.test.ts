import { describe, expect, it } from 'vitest'

import { isReauthError } from './use-two-factor'

describe('isReauthError', () => {
  it('reads the code or the message prefix', () => {
    expect(isReauthError({ code: 'REAUTH_REQUIRED' })).toBe(true)
    expect(
      isReauthError({ message: 'REAUTH_REQUIRED: Sign in again to change' }),
    ).toBe(true)
  })

  it('leaves other failures alone', () => {
    expect(isReauthError({ code: 'INVALID_PASSWORD', message: 'Wrong' })).toBe(
      false,
    )
    expect(isReauthError({})).toBe(false)
  })
})
