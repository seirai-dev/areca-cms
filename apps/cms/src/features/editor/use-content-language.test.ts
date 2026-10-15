import { describe, expect, it } from 'vitest'

import {
  isLanguageShortcut,
  resolveLanguage,
  stepLanguage,
} from './use-content-language'

const all = ['nl', 'en', 'fr']

describe('resolveLanguage', () => {
  it('prefers a valid ?lang= over the remembered choice', () => {
    expect(
      resolveLanguage({ requested: 'fr', remembered: 'en', main: 'nl', all }),
    ).toBe('fr')
  })

  it('ignores a ?lang= the site does not have', () => {
    expect(
      resolveLanguage({ requested: 'de', remembered: 'en', main: 'nl', all }),
    ).toBe('en')
  })

  it('uses the remembered choice when the URL has none', () => {
    expect(
      resolveLanguage({ requested: null, remembered: 'fr', main: 'nl', all }),
    ).toBe('fr')
  })

  it('falls back to main when neither is valid', () => {
    expect(
      resolveLanguage({ requested: null, remembered: 'de', main: 'nl', all }),
    ).toBe('nl')
  })
})

describe('stepLanguage', () => {
  it('moves one step and wraps at both ends', () => {
    expect(stepLanguage(all, 'nl', 1)).toBe('en')
    expect(stepLanguage(all, 'fr', 1)).toBe('nl')
    expect(stepLanguage(all, 'nl', -1)).toBe('fr')
  })
})

describe('isLanguageShortcut', () => {
  const key = (init: {
    altKey?: boolean
    shiftKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
    code: string
  }) => ({
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...init,
  })

  it('Ctrl+Shift+L goes to the next language, Ctrl+Shift+Alt+L to the previous', () => {
    expect(
      isLanguageShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyL' })),
    ).toBe(1)
    expect(
      isLanguageShortcut(
        key({ ctrlKey: true, shiftKey: true, altKey: true, code: 'KeyL' }),
      ),
    ).toBe(-1)
  })

  it('ignores Cmd, a missing Shift or Ctrl, and other keys', () => {
    expect(
      isLanguageShortcut(key({ metaKey: true, shiftKey: true, code: 'KeyL' })),
    ).toBeNull()
    expect(isLanguageShortcut(key({ ctrlKey: true, code: 'KeyL' }))).toBeNull()
    expect(
      isLanguageShortcut(
        key({ shiftKey: true, altKey: true, code: 'ArrowLeft' }),
      ),
    ).toBeNull()
    expect(
      isLanguageShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyA' })),
    ).toBeNull()
  })
})
