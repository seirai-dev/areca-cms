import { describe, expect, it } from 'vitest'

import { m } from '#/paraglide/messages'

import { signInFailureMessage } from './sign-in-error'

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
