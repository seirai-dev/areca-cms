import { describe, expect, it } from 'vitest'

import type { EntryData, Field, SiteLanguages } from '#/lib/types'
import { ValidationError } from '#/server/content/errors'

import {
  applyLocaleWrite,
  localeView,
  resolveLocale,
  translationStatuses,
} from './locales'

const languages: SiteLanguages = { main: 'nl', all: ['nl', 'en', 'fr'] }

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'salary', label: 'Salary', type: 'number' },
  { key: 'heroImage', label: 'Hero', type: 'image', translatable: true },
]

describe('resolveLocale', () => {
  it('returns null for a single-language site without a locale', () => {
    expect(resolveLocale(null, undefined)).toBeNull()
  })

  it('refuses a locale on a single-language site with a clear message', () => {
    expect(() => resolveLocale(null, 'en')).toThrow(ValidationError)
    expect(() => resolveLocale(null, 'en')).toThrow(
      'This site has one language',
    )
  })

  it('defaults to the main language on a multi-language site', () => {
    expect(resolveLocale(languages, undefined)).toEqual({
      locale: 'nl',
      isMain: true,
    })
  })

  it('canonicalises a requested language and flags the main one', () => {
    expect(resolveLocale(languages, 'EN')).toEqual({
      locale: 'en',
      isMain: false,
    })
    expect(resolveLocale(languages, 'nl')).toEqual({
      locale: 'nl',
      isMain: true,
    })
  })

  it('names the site languages when the requested one is not one of them', () => {
    const error = (() => {
      try {
        resolveLocale(languages, 'de')
      } catch (e) {
        return e
      }
      return null
    })()
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).message).toContain('nl, en, fr')
  })
})

describe('localeView', () => {
  const stored: EntryData = {
    title: 'Backend ontwikkelaar',
    slug: 'backend-ontwikkelaar',
    body: { type: 'doc', content: [] },
    salary: 4000,
    $seo: { title: 'SEO NL' },
    $i18n: {
      en: { title: 'Backend developer', $seo: { title: 'SEO EN' } },
    },
  }

  it('reads the main language from the base', () => {
    const view = localeView(stored, languages, fields, 'nl', 'backend-ontwikkelaar')
    expect(view.slug).toBe('backend-ontwikkelaar')
    expect(view.data.title).toBe('Backend ontwikkelaar')
    expect(view.data.$seo).toEqual({ title: 'SEO NL' })
  })

  it('reads a translation, sharing the shared fields and the per-language SEO', () => {
    const view = localeView(stored, languages, fields, 'en', 'backend-ontwikkelaar')
    expect(view.data.title).toBe('Backend developer')
    expect(view.data.salary).toBe(4000)
    expect(view.data.$seo).toEqual({ title: 'SEO EN' })
    expect(view.slug).toBe('backend-ontwikkelaar')
  })

  it('uses the per-language slug when set and keeps the slug field in step', () => {
    const withSlug: EntryData = {
      ...stored,
      $i18n: { en: { title: 'Backend developer', $slug: 'backend-developer' } },
    }
    const view = localeView(withSlug, languages, fields, 'en', 'backend-ontwikkelaar')
    expect(view.slug).toBe('backend-developer')
    expect(view.data.slug).toBe('backend-developer')
  })

  it('shows empty translatable fields for a language that has none yet', () => {
    const view = localeView(stored, languages, fields, 'fr', 'backend-ontwikkelaar')
    expect(view.data.title).toBeUndefined()
    expect(view.data.salary).toBe(4000)
  })
})

describe('applyLocaleWrite', () => {
  const stored: EntryData = {
    title: 'Backend ontwikkelaar',
    slug: 'backend-ontwikkelaar',
    body: { type: 'doc', content: [] },
    salary: 4000,
    $seo: { title: 'SEO NL' },
  }

  it('writes a translation without touching the main language', () => {
    const { data, sharedFieldsUpdated } = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored,
      converted: { title: 'Backend developer' },
    })
    expect(data.title).toBe('Backend ontwikkelaar')
    expect(data.$i18n).toEqual({ en: { title: 'Backend developer' } })
    expect(sharedFieldsUpdated).toEqual([])
  })

  it('keeps the other translatable fields of that language when only some are sent', () => {
    const first = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored,
      converted: { title: 'Backend developer', body: { type: 'doc', content: [] } },
    }).data
    const second = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored: first,
      converted: { title: 'Backend dev' },
    }).data
    expect(second.$i18n).toEqual({
      en: { title: 'Backend dev', body: { type: 'doc', content: [] } },
    })
  })

  it('applies shared fields sent with a translation to the shared value and reports them', () => {
    const { data, sharedFieldsUpdated } = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored,
      converted: { salary: 4500, title: 'Backend developer' },
    })
    expect(data.salary).toBe(4500)
    expect(sharedFieldsUpdated).toEqual(['salary'])
  })

  it('writes a per-language slug to $slug and leaves the main slug alone', () => {
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored,
      converted: { slug: 'backend-developer' },
    })
    expect(data.slug).toBe('backend-ontwikkelaar')
    expect(data.$i18n).toEqual({ en: { $slug: 'backend-developer' } })
  })

  it('clears a per-language slug when it is sent empty', () => {
    const withSlug: EntryData = {
      ...stored,
      $i18n: { en: { $slug: 'backend-developer' } },
    }
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored: withSlug,
      converted: { slug: null },
    })
    expect(data.$i18n).toBeUndefined()
    expect(data.slug).toBe('backend-ontwikkelaar')
  })

  it('writes the main slug to the base for the main language', () => {
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'nl',
      stored,
      converted: { slug: 'nieuwe-slug' },
    })
    expect(data.slug).toBe('nieuwe-slug')
    expect(data.$i18n).toBeUndefined()
  })

  it('merges SEO into the language it belongs to', () => {
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored,
      converted: {},
      seo: { description: 'English description' },
    })
    expect(data.$seo).toEqual({ title: 'SEO NL' })
    expect(data.$i18n).toEqual({
      en: { $seo: { description: 'English description' } },
    })
  })

  it('removes SEO keys cleared in the language without touching the main SEO', () => {
    const withSeo: EntryData = {
      ...stored,
      $i18n: { en: { $seo: { title: 'SEO EN', description: 'D' } } },
    }
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'en',
      stored: withSeo,
      converted: {},
      seo: { description: null },
    })
    expect(data.$seo).toEqual({ title: 'SEO NL' })
    expect(data.$i18n).toEqual({ en: { $seo: { title: 'SEO EN' } } })
  })

  it('writes the main language as it did before languages existed', () => {
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'nl',
      stored,
      converted: { title: 'Nieuwe titel' },
      seo: { title: 'Nieuw' },
    })
    expect(data).toEqual({
      title: 'Nieuwe titel',
      slug: 'backend-ontwikkelaar',
      body: { type: 'doc', content: [] },
      salary: 4000,
      $seo: { title: 'Nieuw' },
    })
  })

  it('drops SEO for a section without SEO', () => {
    const { data } = applyLocaleWrite({
      fields,
      languages,
      locale: 'nl',
      stored,
      converted: {},
      seo: { title: 'x' },
      seoEnabled: false,
    })
    expect(data.$seo).toBeUndefined()
  })
})

describe('translationStatuses', () => {
  it('reports each non-main language with its missing required fields', () => {
    const stored: EntryData = {
      title: 'Titel',
      slug: 'titel',
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      $i18n: { en: { title: 'Title' } },
    }
    const statuses = translationStatuses(stored, languages, fields)
    expect(statuses).toEqual({
      en: { complete: false, missing: ['body'] },
      fr: { complete: false, missing: ['title', 'body'] },
    })
  })
})
