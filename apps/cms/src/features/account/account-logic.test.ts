import { describe, expect, it } from 'vitest'

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  canSaveName,
  deleteProofFor,
  emailMatches,
  validatePasswordChange,
} from './account-logic'

describe('validatePasswordChange', () => {
  const good = 'correct horse'

  it('accepts a current password and a matching new password of allowed length', () => {
    expect(
      validatePasswordChange({ current: 'old', next: good, confirm: good }),
    ).toEqual({})
  })

  it('requires the current password', () => {
    expect(
      validatePasswordChange({ current: '', next: good, confirm: good }),
    ).toEqual({ current: 'current_required' })
  })

  it('enforces the minimum length on the new password', () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1)
    expect(
      validatePasswordChange({ current: 'old', next: short, confirm: short }),
    ).toEqual({ next: 'too_short' })
    const exact = 'a'.repeat(PASSWORD_MIN_LENGTH)
    expect(
      validatePasswordChange({ current: 'old', next: exact, confirm: exact }),
    ).toEqual({})
  })

  it('enforces the maximum length on the new password', () => {
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1)
    expect(
      validatePasswordChange({ current: 'old', next: long, confirm: long }),
    ).toEqual({ next: 'too_long' })
  })

  it('reports a confirmation that does not match', () => {
    expect(
      validatePasswordChange({
        current: 'old',
        next: good,
        confirm: `${good}!`,
      }),
    ).toEqual({ confirm: 'mismatch' })
  })

  it('can report several problems at once', () => {
    expect(
      validatePasswordChange({ current: '', next: 'short', confirm: '' }),
    ).toEqual({
      current: 'current_required',
      next: 'too_short',
      confirm: 'mismatch',
    })
  })
})

describe('canSaveName', () => {
  it('is false for an unchanged name, ignoring surrounding spaces', () => {
    expect(canSaveName('Jane Doe', 'Jane Doe')).toBe(false)
    expect(canSaveName('  Jane Doe ', 'Jane Doe')).toBe(false)
  })

  it('is false for a blank name', () => {
    expect(canSaveName('   ', 'Jane Doe')).toBe(false)
  })

  it('is true once the trimmed name differs', () => {
    expect(canSaveName('Jane Smith', 'Jane Doe')).toBe(true)
  })
})

describe('deleteProofFor', () => {
  it('asks for the password when the account has one, even with two-factor', () => {
    expect(deleteProofFor({ hasPassword: true, twoFactorEnabled: true })).toBe(
      'password',
    )
    expect(deleteProofFor({ hasPassword: true, twoFactorEnabled: false })).toBe(
      'password',
    )
  })

  it('asks for a two-factor code when there is no password', () => {
    expect(deleteProofFor({ hasPassword: false, twoFactorEnabled: true })).toBe(
      'code',
    )
  })

  it('asks for nothing beyond the typed email for SSO-only accounts without two-factor', () => {
    expect(
      deleteProofFor({ hasPassword: false, twoFactorEnabled: false }),
    ).toBe('none')
  })
})

describe('emailMatches', () => {
  it('ignores case and surrounding spaces, like the server', () => {
    expect(emailMatches('  Jane@Acme.com ', 'jane@acme.com')).toBe(true)
  })

  it('rejects a different address', () => {
    expect(emailMatches('jane@acme.co', 'jane@acme.com')).toBe(false)
    expect(emailMatches('', 'jane@acme.com')).toBe(false)
  })
})
