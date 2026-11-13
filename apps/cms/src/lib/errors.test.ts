import { describe, expect, it } from 'vitest'

import { errorDetail, errorMessage } from './errors.ts'
import { MfaRequiredError, ReauthRequiredError } from './security-errors.ts'

describe('errorMessage', () => {
  it('strips the security code from an Error', () => {
    expect(errorMessage(new MfaRequiredError('Enrol first'))).toBe(
      'Enrol first',
    )
  })

  it('strips the security code from a plain error-shaped object', () => {
    const sent = new ReauthRequiredError('Confirm it is you')
    expect(errorMessage({ message: sent.message })).toBe('Confirm it is you')
  })

  it('keeps an ordinary message', () => {
    expect(errorMessage(new Error('Slug taken'))).toBe('Slug taken')
    expect(errorMessage({ message: 'Slug taken' })).toBe('Slug taken')
  })

  it('falls back when there is no message', () => {
    expect(errorMessage(null, 'Nope')).toBe('Nope')
    expect(errorMessage(new Error(''), 'Nope')).toBe('Nope')
    expect(errorMessage({ message: 42 }, 'Nope')).toBe('Nope')
    expect(errorMessage('a string', 'Nope')).toBe('Nope')
    expect(errorMessage(undefined)).toBeTruthy()
  })
})

describe('errorDetail', () => {
  it('returns the server message without its code', () => {
    expect(errorDetail(new MfaRequiredError('Enrol first'))).toBe('Enrol first')
    expect(errorDetail({ message: 'Forbidden' })).toBe('Forbidden')
  })

  it('hides developer messages', () => {
    expect(errorDetail(new TypeError('Failed to fetch'))).toBeNull()
    expect(errorDetail(new Error('Query data cannot be undefined'))).toBeNull()
    expect(errorDetail(new Error('x is not a function'))).toBeNull()
    expect(errorDetail(null)).toBeNull()
  })
})
