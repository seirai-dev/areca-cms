import { describe, expect, it } from 'vitest'

import {
  MFA_REQUIRED,
  MfaRequiredError,
  REAUTH_REQUIRED,
  ReauthRequiredError,
  securityErrorCode,
  stripSecurityCode,
} from './security-errors.ts'

describe('security errors', () => {
  it('carries a code on the instance', () => {
    expect(new MfaRequiredError().code).toBe(MFA_REQUIRED)
    expect(new ReauthRequiredError().code).toBe(REAUTH_REQUIRED)
  })

  it('reads the code back from a deserialised error (message only)', () => {
    const sent = new MfaRequiredError('Enrol first')
    const received = new Error(sent.message)
    expect(securityErrorCode(received)).toBe(MFA_REQUIRED)
    expect(
      securityErrorCode(new Error(new ReauthRequiredError().message)),
    ).toBe(REAUTH_REQUIRED)
  })

  it('ignores unrelated errors', () => {
    expect(securityErrorCode(new Error('Forbidden'))).toBeNull()
    expect(securityErrorCode('MFA_REQUIRED')).toBeNull()
    expect(securityErrorCode(null)).toBeNull()
  })

  it('strips the code for display', () => {
    expect(stripSecurityCode(new MfaRequiredError('Enrol first').message)).toBe(
      'Enrol first',
    )
    expect(stripSecurityCode('Something else')).toBe('Something else')
  })
})
