import { describe, expect, it } from 'vitest'

import {
  carryFieldValues,
  fieldContentKeys,
  holdsAnyFieldKey,
  isBlankFieldValue,
  withoutFieldKeys,
} from './field-content'

describe('isBlankFieldValue', () => {
  it('treats null, empty or spaces-only text, and empty lists and objects as blank', () => {
    for (const value of [null, undefined, '', '   ', [], {}]) {
      expect(isBlankFieldValue(value)).toBe(true)
    }
  })

  it('treats any other value as content', () => {
    for (const value of ['x', 0, false, [1], { a: 1 }]) {
      expect(isBlankFieldValue(value)).toBe(false)
    }
  })
})

describe('fieldContentKeys', () => {
  it('lists the keys that hold content, base and language slots, and skips blanks', () => {
    expect(
      [
        ...fieldContentKeys({
          title: 'A',
          excerpt: '',
          tags: [],
          $locale: 'en',
          $i18n: { nl: { excerpt: 'Inleiding', title: ' ' } },
        }),
      ].sort(),
    ).toEqual(['excerpt', 'title'])
  })

  it('is empty for missing data', () => {
    expect(fieldContentKeys(null).size).toBe(0)
  })
})

describe('holdsAnyFieldKey', () => {
  it('finds a key in the base, in a language slot, and even when the value is blank', () => {
    expect(holdsAnyFieldKey({ excerpt: '' }, ['excerpt'])).toBe(true)
    expect(
      holdsAnyFieldKey({ $i18n: { nl: { excerpt: 'x' } } }, ['excerpt']),
    ).toBe(true)
    expect(holdsAnyFieldKey({ title: 'x' }, ['excerpt'])).toBe(false)
    expect(holdsAnyFieldKey(null, ['excerpt'])).toBe(false)
  })
})

describe('withoutFieldKeys', () => {
  it('removes the keys from the base and from every language slot', () => {
    expect(
      withoutFieldKeys(
        {
          title: 'A',
          excerpt: 'x',
          $i18n: { nl: { excerpt: 'y', title: 'B' } },
        },
        ['excerpt'],
      ),
    ).toEqual({ title: 'A', $i18n: { nl: { title: 'B' } } })
  })
})

describe('carryFieldValues', () => {
  it('takes the listed fields from the source, base and language slots', () => {
    const target = {
      title: 'Dev',
      $i18n: { nl: { title: 'Dev NL' } },
    }
    const source = {
      title: 'Prod',
      excerpt: 'Intro',
      $i18n: { nl: { excerpt: 'Inleiding' } },
    }
    expect(carryFieldValues(target, source, ['excerpt'])).toEqual({
      title: 'Dev',
      excerpt: 'Intro',
      $i18n: { nl: { title: 'Dev NL', excerpt: 'Inleiding' } },
    })
  })

  it('removes a listed field the source does not hold', () => {
    expect(
      carryFieldValues({ title: 'Dev', excerpt: 'stale' }, { title: 'Prod' }, [
        'excerpt',
      ]),
    ).toEqual({ title: 'Dev' })
  })

  it('returns the target unchanged when no field is listed', () => {
    const target = { title: 'Dev' }
    expect(carryFieldValues(target, { excerpt: 'x' }, [])).toBe(target)
  })

  it('makes a language slot only for a value it carries', () => {
    expect(
      carryFieldValues({ title: 'Dev' }, { $i18n: { nl: { excerpt: 'x' } } }, [
        'excerpt',
      ]),
    ).toEqual({ title: 'Dev', $i18n: { nl: { excerpt: 'x' } } })
    expect(
      carryFieldValues({ title: 'Dev' }, { $i18n: { nl: { title: 'x' } } }, [
        'excerpt',
      ]),
    ).toEqual({ title: 'Dev' })
  })
})
