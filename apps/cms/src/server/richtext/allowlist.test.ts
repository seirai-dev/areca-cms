import { describe, expect, it } from 'vitest'

import { isAllowedLinkHref, isExternalHref, isInternalHref } from './allowlist'

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
    '/café/ñandú',
    'https://café.example/ü',
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

// Characters that browsers strip or reorder inside a URL. Each one must be
// rejected in a site path and in an https URL alike.
const UNSAFE_CHARACTERS: Array<[string, string]> = [
  ['C1 U+0080', '\u0080'],
  ['C1 U+0085 (NEL)', '\u0085'],
  ['C1 U+009F', '\u009f'],
  ['zero-width space U+200B', '\u200b'],
  ['zero-width non-joiner U+200C', '\u200c'],
  ['zero-width joiner U+200D', '\u200d'],
  ['left-to-right mark U+200E', '\u200e'],
  ['right-to-left mark U+200F', '\u200f'],
  ['line separator U+2028', '\u2028'],
  ['paragraph separator U+2029', '\u2029'],
  ['byte-order mark U+FEFF', '\ufeff'],
  ['bidi override U+202E', '\u202e'],
  ['bidi isolate U+2066', '\u2066'],
  ['pop directional isolate U+2069', '\u2069'],
  ['no-break space U+00A0', '\u00a0'],
  ['tab U+0009', '\t'],
  ['DEL U+007F', '\u007f'],
]

describe('isAllowedLinkHref: control, zero-width and bidi characters', () => {
  it.each(UNSAFE_CHARACTERS)('blocks %s in a site path', (_label, char) => {
    expect(isAllowedLinkHref(`/a${char}b`)).toBe(false)
    expect(isAllowedLinkHref(`/${char}evil`)).toBe(false)
    expect(isAllowedLinkHref(`#a${char}b`)).toBe(false)
  })

  it.each(UNSAFE_CHARACTERS)('blocks %s in an https URL', (_label, char) => {
    expect(isAllowedLinkHref(`https://x.com/a${char}b`)).toBe(false)
    expect(isAllowedLinkHref(`https://x${char}.com`)).toBe(false)
    expect(isAllowedLinkHref(`mailto:a${char}@b.c`)).toBe(false)
  })

  it('blocks the C1 control from the review finding', () => {
    expect(isAllowedLinkHref('/\u0085evil')).toBe(false)
    expect(isAllowedLinkHref('/\u0080evil')).toBe(false)
    expect(isAllowedLinkHref('/\u009fevil')).toBe(false)
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

describe('isExternalHref', () => {
  it('is true for http and https links only', () => {
    expect(isExternalHref('https://example.com')).toBe(true)
    expect(isExternalHref('HTTP://example.com')).toBe(true)
    expect(isExternalHref('/coffees/x')).toBe(false)
    expect(isExternalHref('#faq')).toBe(false)
    expect(isExternalHref('mailto:a@b.c')).toBe(false)
  })
})
