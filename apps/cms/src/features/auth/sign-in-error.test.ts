import { describe, expect, it } from 'vitest'

import { m } from '#/paraglide/messages'

import { providerErrorMessage, signInFailureMessage } from './sign-in-error'

describe('signInFailureMessage', () => {
  it('tells a blocked person to contact their agency, whatever the server said', () => {
    expect(
      signInFailureMessage({
        code: 'ACCOUNT_BLOCKED',
        message: 'Blocked because of the reason',
      }),
    ).toBe(m.auth_account_blocked())
  })

  it('passes other messages through and falls back to the generic copy', () => {
    expect(signInFailureMessage({ message: 'Invalid email or password' })).toBe(
      'Invalid email or password',
    )
    expect(signInFailureMessage({})).toBe(m.auth_could_not_sign_in())
  })
})

describe('providerErrorMessage', () => {
  it('tells someone with an unverified account how to link a provider', () => {
    expect(providerErrorMessage('account_not_linked')).toBe(
      m.auth_account_not_linked(),
    )
    expect(providerErrorMessage('account not linked')).toBe(
      m.auth_account_not_linked(),
    )
  })

  it('keeps the blocked and invite-only copy and a generic fallback', () => {
    expect(providerErrorMessage(undefined)).toBeNull()
    expect(providerErrorMessage('ACCOUNT_BLOCKED')).toBe(
      m.auth_account_blocked(),
    )
    expect(providerErrorMessage('REGISTRATION_NOT_ALLOWED')).toBe(
      m.auth_registration_not_allowed(),
    )
    expect(providerErrorMessage('invalid_code')).toBe(
      m.auth_could_not_sign_in(),
    )
  })
})
