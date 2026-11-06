import { describe, expect, it } from 'vitest'

import { isAllowedLinkHref, isInternalHref } from './allowlist'

describe('isAllowedLinkHref', () => {
  it.each([
    '/',
    '/a',
    '/a/b?c=d#e',
    '/coffees/x',
    '/coffees/x#faq',
    '/search?q=a',
    '#faq',
    'https://x.com',
    'https://x.com/path?q=1#frag',
    'http://x.com',
    'mailto:a@b.c',
  ])('allows %s', (href) => {
    expect(isAllowedLinkHref(href)).toBe(true)
  })

  it.each([
    '#',
    '//evil.com',
    '/\\evil.com',
    '\\evil',
    '/a\\b',
    '/a b',
    '/a\tb',
    '/a\nb',
    '/a\u0000b',
    '/a\u007Fb',
    ' /a',
    '/a ',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,x',
    'https:///x',
    'https://',
    'https:/x.com',
    'ftp://x',
    'vbscript:x',
    'file:///etc/passwd',
    'about',
    'x.com',
    '',
  ])('blocks %j', (href) => {
    expect(isAllowedLinkHref(href)).toBe(false)
  })
})

describe('isInternalHref', () => {
  it('is true for site paths and anchors only', () => {
    expect(isInternalHref('/coffees/x')).toBe(true)
    expect(isInternalHref('/')).toBe(true)
    expect(isInternalHref('#faq')).toBe(true)
    expect(isInternalHref('https://x.com')).toBe(false)
    expect(isInternalHref('mailto:a@b.c')).toBe(false)
    expect(isInternalHref('//evil.com')).toBe(false)
    expect(isInternalHref('#')).toBe(false)
  })
})
