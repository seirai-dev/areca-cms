import { describe, expect, it } from 'vitest'

import {
  passwordResetRateLimited,
  passwordsMatch,
  resetTokenInvalid,
} from './password-reset-logic'

describe('passwordResetRateLimited', () => {
  it('recognises the rate-limit code and HTTP 429', () => {
    expect(
      passwordResetRateLimited({ code: 'PASSWORD_RESET_RATE_LIMITED' }),
    ).toBe(true)
    expect(passwordResetRateLimited({ status: 429 })).toBe(true)
  })

  it('ignores other failures and empty errors', () => {
    expect(
      passwordResetRateLimited({ code: 'INVALID_TOKEN', status: 400 }),
    ).toBe(false)
    expect(passwordResetRateLimited(null)).toBe(false)
    expect(passwordResetRateLimited(undefined)).toBe(false)
  })
})

describe('resetTokenInvalid', () => {
  it('is true only for the invalid-token code', () => {
    expect(resetTokenInvalid({ code: 'INVALID_TOKEN' })).toBe(true)
    expect(resetTokenInvalid({ code: 'PASSWORD_TOO_SHORT' })).toBe(false)
    expect(resetTokenInvalid(undefined)).toBe(false)
  })
})

describe('passwordsMatch', () => {
  it('requires an exact match', () => {
    expect(passwordsMatch('correct horse', 'correct horse')).toBe(true)
    expect(passwordsMatch('correct horse', 'correct horse ')).toBe(false)
    expect(passwordsMatch('', '')).toBe(true)
  })
})
