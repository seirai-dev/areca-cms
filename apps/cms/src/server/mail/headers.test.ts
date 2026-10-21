import { describe, expect, it } from 'vitest'

import { formatFrom, isMailAddress } from './headers.ts'

describe('formatFrom', () => {
  it('returns the bare address when there is no name', () => {
    expect(formatFrom('cms@example.com')).toBe('cms@example.com')
    expect(formatFrom('cms@example.com', '   ')).toBe('cms@example.com')
  })

  it('wraps the address with the display name', () => {
    expect(formatFrom('cms@example.com', 'Areca Studio')).toBe(
      '"Areca Studio" <cms@example.com>',
    )
  })

  it('replaces an existing display name', () => {
    expect(formatFrom('Old <cms@example.com>', 'New')).toBe(
      '"New" <cms@example.com>',
    )
  })

  it('strips characters that would break the header', () => {
    expect(formatFrom('cms@example.com', 'Ev"il<\n>')).toBe(
      '"Evil" <cms@example.com>',
    )
  })
})

describe('isMailAddress', () => {
  it.each([
    'cms@example.com',
    '"Areca" <cms@example.com>',
    'Areca <cms@example.com>',
  ])('accepts %s', (value) => {
    expect(isMailAddress(value)).toBe(true)
  })

  it.each([
    '',
    'not an email',
    'cms@',
    'cms@example',
    'Areca <cms@example>',
    'a@b.c <',
  ])('rejects %s', (value) => {
    expect(isMailAddress(value)).toBe(false)
  })
})
