import { describe, expect, it } from 'vitest'

import { readLocale } from '#/lib/content-locale'
import type { LocaleCtx } from '#/lib/content-locale'
import type { Field } from '#/lib/types'

import { initialEntryData } from './utils'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'location', label: 'Location', type: 'text' },
]

const ctx: LocaleCtx = { main: 'nl', all: ['nl', 'en'], fields }

describe('initialEntryData (editor hydration)', () => {
  it('keeps the translations and base language of a stored draft', () => {
    // Regression: the editor hydrated from the server dropped `$i18n`, so a
    // reload showed the English title empty and blocked ready on it.
    const stored = {
      title: 'Backend ontwikkelaar',
      location: 'Utrecht',
      $i18n: { en: { title: 'Backend developer' } },
    }

    const hydrated = initialEntryData(fields, stored)

    expect(readLocale(hydrated, 'en', ctx).title).toBe('Backend developer')
    expect(readLocale(hydrated, 'nl', ctx).title).toBe('Backend ontwikkelaar')
    expect(hydrated.location).toBe('Utrecht')
  })

  it('keeps `$locale` when the base values are not in the main language', () => {
    const stored = {
      title: 'Backend developer',
      $locale: 'en',
      $i18n: { nl: { title: 'Backend ontwikkelaar' } },
    }

    const hydrated = initialEntryData(fields, stored)

    expect(hydrated.$locale).toBe('en')
    expect(readLocale(hydrated, 'nl', ctx).title).toBe('Backend ontwikkelaar')
  })

  it('leaves data without translations unchanged', () => {
    const hydrated = initialEntryData(fields, { title: 'A' })
    expect(hydrated).not.toHaveProperty('$i18n')
    expect(hydrated).not.toHaveProperty('$locale')
  })
})
