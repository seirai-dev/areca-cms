import { describe, expect, it } from 'vitest'

import { safeRedirectPath } from './safe-redirect'

describe('safeRedirectPath', () => {
  it.each([
    '/',
    '/sites/abc',
    '/sites/abc/entries?tab=ready#top',
    '/oauth2/authorize?redirect_uri=https%3A%2F%2Fclient.example%2Fcb',
    '/search?q=a%20b',
  ])('keeps the in-app path %s', (value) => {
    expect(safeRedirectPath(value)).toBe(value)
  })

  it.each([
    undefined,
    null,
    42,
    '',
    'sites/abc',
    'https://evil.example',
    '//evil.example',
    '//evil',
    '/\\evil.example',
    '/\\evil.example/login',
    '/\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/ /evil.example',
    '/sites/abc def',
    '/\x00evil',
    '/\x7fevil',
    '/%5Cevil.example',
    '/%5cevil.example',
    '/%2Fevil.example',
    '/%2f%2fevil.example',
    '/sites%2F..%2F..%2Fevil',
  ])('falls back to / for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/')
  })
})
