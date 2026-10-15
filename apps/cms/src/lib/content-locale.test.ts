import { describe, expect, it } from 'vitest'

import {
  I18N_KEY,
  LOCALE_KEY,
  SLUG_KEY,
  TRANSLATABLE_BY_DEFAULT,
  baseLocale,
  isTranslatable,
  localeStatus,
  normalizeBase,
  readLocale,
  resolveChain,
  servedLocales,
  writeLocale,
} from './content-locale.ts'
import type { LocaleCtx } from './content-locale.ts'
import type { Field, FieldType } from './types.ts'

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'salary', label: 'Salary', type: 'number' },
  { key: 'hero', label: 'Hero', type: 'image' },
  { key: 'heroAlt', label: 'Hero alt', type: 'image', translatable: true },
  { key: 'closes', label: 'Closes', type: 'date' },
  { key: 'slug', label: 'Slug', type: 'slug' },
  { key: 'link', label: 'Link', type: 'url' },
  { key: 'featured', label: 'Featured', type: 'text', translatable: false },
]

const ctx: LocaleCtx = { main: 'nl', all: ['nl', 'en', 'fr'], fields }

describe('TRANSLATABLE_BY_DEFAULT', () => {
  it('turns text-like field types on and everything else off', () => {
    const on: FieldType[] = ['text', 'textarea', 'richtext', 'url']
    const off: FieldType[] = [
      'image',
      'date',
      'datetime',
      'select',
      'reference',
      'slug',
      'boolean',
      'number',
    ]
    for (const type of on) expect(TRANSLATABLE_BY_DEFAULT[type]).toBe(true)
    for (const type of off) expect(TRANSLATABLE_BY_DEFAULT[type]).toBe(false)
  })
})

describe('isTranslatable', () => {
  it('uses the type default when the switch is unset', () => {
    expect(isTranslatable({ key: 'a', label: 'A', type: 'text' })).toBe(true)
    expect(isTranslatable({ key: 'a', label: 'A', type: 'number' })).toBe(false)
  })

  it('lets the explicit switch override the default both ways', () => {
    expect(
      isTranslatable({
        key: 'a',
        label: 'A',
        type: 'number',
        translatable: true,
      }),
    ).toBe(true)
    expect(
      isTranslatable({
        key: 'a',
        label: 'A',
        type: 'text',
        translatable: false,
      }),
    ).toBe(false)
  })
})

describe('key constants', () => {
  it('uses the reserved $-prefixed keys', () => {
    expect(I18N_KEY).toBe('$i18n')
    expect(LOCALE_KEY).toBe('$locale')
    expect(SLUG_KEY).toBe('$slug')
  })
})

describe('baseLocale', () => {
  it('falls back to the main language when $locale is absent', () => {
    expect(baseLocale({}, ctx)).toBe('nl')
  })

  it('reads $locale when present', () => {
    expect(baseLocale({ $locale: 'en' }, ctx)).toBe('en')
  })
})

describe('readLocale', () => {
  const data = {
    title: 'Backend ontwikkelaar',
    body: doc('Nederlands'),
    salary: 4000,
    hero: 'asset-1',
    featured: 'yes',
    $slug: 'backend-ontwikkelaar',
    $seo: { title: 'SEO NL' },
    $i18n: {
      en: {
        title: 'Backend developer',
        body: doc('English'),
        $slug: 'backend-developer',
        $seo: { title: 'SEO EN' },
      },
      fr: { title: 'Développeur backend' },
    },
  }

  it('returns the base language values for the base locale', () => {
    expect(readLocale(data, 'nl', ctx)).toEqual({
      title: 'Backend ontwikkelaar',
      body: doc('Nederlands'),
      salary: 4000,
      hero: 'asset-1',
      featured: 'yes',
      $slug: 'backend-ontwikkelaar',
      $seo: { title: 'SEO NL' },
    })
  })

  it('merges shared fields from the base with the requested translation', () => {
    expect(readLocale(data, 'en', ctx)).toEqual({
      title: 'Backend developer',
      body: doc('English'),
      salary: 4000,
      hero: 'asset-1',
      featured: 'yes',
      $slug: 'backend-developer',
      $seo: { title: 'SEO EN' },
    })
  })

  it('omits translatable keys a language does not have', () => {
    const view = readLocale(data, 'de', ctx)
    expect(view).toEqual({ salary: 4000, hero: 'asset-1', featured: 'yes' })
    expect(view).not.toHaveProperty('title')
    expect(view).not.toHaveProperty('$seo')
    expect(view).not.toHaveProperty('$slug')
  })

  it('reads a partial translation with only the keys it has', () => {
    expect(readLocale(data, 'fr', ctx)).toEqual({
      title: 'Développeur backend',
      salary: 4000,
      hero: 'asset-1',
      featured: 'yes',
    })
  })

  it('never includes $i18n or $locale', () => {
    const view = readLocale({ ...data, $locale: 'en' }, 'en', ctx)
    expect(view).not.toHaveProperty('$i18n')
    expect(view).not.toHaveProperty('$locale')
  })

  it('treats the base as the requested language when $locale is set', () => {
    const rebased = {
      title: 'Backend developer',
      salary: 4000,
      $locale: 'en',
      $i18n: { nl: { title: 'Backend ontwikkelaar' } },
    }
    expect(readLocale(rebased, 'en', ctx)).toEqual({
      title: 'Backend developer',
      salary: 4000,
    })
    expect(readLocale(rebased, 'nl', ctx)).toEqual({
      title: 'Backend ontwikkelaar',
      salary: 4000,
    })
  })

  it('ignores undeclared keys and keeps shared fields that are not set', () => {
    const view = readLocale({ title: 'x', stray: 1 }, 'nl', ctx)
    expect(view).toEqual({ title: 'x' })
  })
})

describe('writeLocale', () => {
  it('writes base translatable values into the base without creating $i18n', () => {
    const next = writeLocale(
      { title: 'Oud', salary: 1 },
      'nl',
      { title: 'Nieuw', salary: 1 },
      ctx,
    )
    expect(next).toEqual({ title: 'Nieuw', salary: 1 })
  })

  it('writes a non-base translatable value into $i18n and leaves the base alone', () => {
    const next = writeLocale(
      { title: 'Backend ontwikkelaar', salary: 4000 },
      'en',
      { title: 'Backend developer', salary: 4000 },
      ctx,
    )
    expect(next).toEqual({
      title: 'Backend ontwikkelaar',
      salary: 4000,
      $i18n: { en: { title: 'Backend developer' } },
    })
  })

  it('sends $seo and $slug to the language they belong to', () => {
    const next = writeLocale(
      { title: 'Titel' },
      'en',
      { title: 'Title', $slug: 'title', $seo: { title: 'SEO' } },
      ctx,
    )
    expect(next).toEqual({
      title: 'Titel',
      $i18n: { en: { title: 'Title', $slug: 'title', $seo: { title: 'SEO' } } },
    })
  })

  it('writes shared values into the base even when another language is written', () => {
    const next = writeLocale(
      { title: 'Titel', salary: 1 },
      'en',
      { title: 'Title', salary: 9 },
      ctx,
    )
    expect(next.salary).toBe(9)
    expect(next).not.toHaveProperty('$i18n.en.salary')
  })

  it('writes to the base when $locale names the requested language', () => {
    const next = writeLocale(
      { title: 'Backend developer', $locale: 'en' },
      'en',
      { title: 'Backend dev' },
      ctx,
    )
    expect(next).toEqual({ title: 'Backend dev', $locale: 'en' })
  })

  it('clears a language value when the key is absent from values', () => {
    const next = writeLocale(
      {
        title: 'Backend ontwikkelaar',
        $i18n: { en: { title: 'Backend developer' } },
      },
      'en',
      {},
      ctx,
    )
    expect(next).toEqual({ title: 'Backend ontwikkelaar' })
    expect(next).not.toHaveProperty('$i18n')
  })

  it('drops an $i18n language that becomes empty and keeps others', () => {
    const next = writeLocale(
      {
        title: 'a',
        $i18n: { en: { title: 'b' }, fr: { title: 'c' } },
      },
      'en',
      {},
      ctx,
    )
    expect(next).toEqual({ title: 'a', $i18n: { fr: { title: 'c' } } })
  })

  it('does not mutate the input', () => {
    const input = {
      title: 'a',
      $i18n: { en: { title: 'b' } },
    }
    const snapshot = structuredClone(input)
    const next = writeLocale(input, 'en', { title: 'z' }, ctx)
    expect(input).toEqual(snapshot)
    expect(next).not.toBe(input)
  })

  it('ignores $i18n and $locale keys passed in values', () => {
    const next = writeLocale(
      { title: 'a' },
      'en',
      { title: 'b', $i18n: { fr: {} }, $locale: 'fr' },
      ctx,
    )
    expect(next).toEqual({ title: 'a', $i18n: { en: { title: 'b' } } })
  })

  it('round-trips with readLocale', () => {
    const view = {
      title: 'Backend developer',
      body: doc('English'),
      salary: 4000,
    }
    const stored = writeLocale(
      { title: 'Backend ontwikkelaar' },
      'en',
      view,
      ctx,
    )
    expect(readLocale(stored, 'en', ctx)).toEqual(view)
  })
})

describe('localeStatus', () => {
  it('is complete when every required translatable field has a value', () => {
    const data = {
      title: 'Titel',
      body: doc('Tekst'),
      $i18n: { en: { title: 'Backend developer', body: doc('English') } },
    }
    expect(localeStatus(data, 'en', ctx)).toEqual({
      started: true,
      complete: true,
      missing: [],
    })
  })

  it('lists required translatable fields that are empty', () => {
    const data = {
      title: 'Titel',
      body: doc('Tekst'),
      $i18n: { en: { title: '   ', body: emptyDoc } },
    }
    expect(localeStatus(data, 'en', ctx)).toEqual({
      started: false,
      complete: false,
      missing: ['title', 'body'],
    })
  })

  it('treats null, empty string, empty array and whitespace as empty', () => {
    const arrayField: Field[] = [
      { key: 'title', label: 'T', type: 'text', required: true },
      {
        key: 'tags',
        label: 'Tags',
        type: 'select',
        required: true,
        translatable: true,
        options: ['a'],
      },
    ]
    const local: LocaleCtx = {
      main: 'nl',
      all: ['nl', 'en'],
      fields: arrayField,
    }
    const data = { title: 'x', $i18n: { en: { title: null, tags: [] } } }
    expect(localeStatus(data, 'en', local).missing).toEqual(['title', 'tags'])
    const blank = { title: 'x', $i18n: { en: { title: '' } } }
    expect(localeStatus(blank, 'en', local).missing).toEqual(['title', 'tags'])
  })

  it('does not count optional translatable fields as missing', () => {
    const data = {
      title: 'Titel',
      body: doc('Tekst'),
      summary: '',
      $i18n: { en: { title: 'T', body: doc('x') } },
    }
    expect(localeStatus(data, 'en', ctx)).toEqual({
      started: true,
      complete: true,
      missing: [],
    })
  })

  it('is not started when a language has nothing filled in', () => {
    expect(localeStatus({ title: 'Titel' }, 'en', ctx)).toEqual({
      started: false,
      complete: false,
      missing: ['title', 'body'],
    })
  })

  it('counts $seo or $slug alone as started', () => {
    const withSlug = { title: 'Titel', $i18n: { en: { $slug: 'title' } } }
    expect(localeStatus(withSlug, 'en', ctx).started).toBe(true)
    const withSeo = {
      title: 'Titel',
      $i18n: { en: { $seo: { title: 'SEO' } } },
    }
    expect(localeStatus(withSeo, 'en', ctx).started).toBe(true)
  })

  it('does not count shared fields toward a non-base language', () => {
    const data = { title: 'Titel', salary: 4000, $i18n: undefined }
    expect(localeStatus(data, 'en', ctx).started).toBe(false)
  })

  it('counts any filled field, shared included, as started for the base language', () => {
    expect(localeStatus({ salary: 4000 }, 'nl', ctx)).toEqual({
      started: true,
      complete: false,
      missing: ['title', 'body'],
    })
    expect(localeStatus({}, 'nl', ctx).started).toBe(false)
  })

  it('treats an empty richtext document as empty, but one with text as filled', () => {
    const emptyBody = { title: 'x', body: emptyDoc }
    expect(localeStatus(emptyBody, 'nl', ctx).missing).toEqual(['body'])
    const filledBody = { title: 'x', body: doc('Tekst') }
    expect(localeStatus(filledBody, 'nl', ctx).complete).toBe(true)
  })

  it('does not treat a mis-typed richtext value as empty', () => {
    const odd = {
      title: 'x',
      body: { type: 'doc', content: [{ type: 'heading' }] },
    }
    expect(localeStatus(odd, 'nl', ctx).complete).toBe(true)
  })
})

describe('normalizeBase', () => {
  const twoLanguageData = {
    $locale: 'en',
    title: 'Backend developer',
    body: doc('English'),
    salary: 4000,
    $slug: 'backend-developer',
    $seo: { title: 'SEO EN' },
    $i18n: {
      nl: {
        title: 'Backend ontwikkelaar',
        body: doc('Nederlands'),
        $slug: 'backend-ontwikkelaar',
        $seo: { title: 'SEO NL' },
      },
      fr: { title: 'Développeur backend' },
    },
  }

  it('returns the same object when the base already is the main language', () => {
    const data = { title: 'x', $i18n: { en: { title: 'y' } } }
    expect(normalizeBase(data, ctx)).toBe(data)
  })

  it('returns the same object when $locale names the main language', () => {
    const data = { $locale: 'nl', title: 'x' }
    expect(normalizeBase(data, ctx)).toBe(data)
  })

  it('moves the main language into the base and the old base into $i18n', () => {
    const normalized = normalizeBase(twoLanguageData, ctx)
    expect(normalized).toEqual({
      title: 'Backend ontwikkelaar',
      body: doc('Nederlands'),
      salary: 4000,
      $slug: 'backend-ontwikkelaar',
      $seo: { title: 'SEO NL' },
      $i18n: {
        en: {
          title: 'Backend developer',
          body: doc('English'),
          $slug: 'backend-developer',
          $seo: { title: 'SEO EN' },
        },
        fr: { title: 'Développeur backend' },
      },
    })
    expect(normalized).not.toHaveProperty('$locale')
  })

  it('keeps every language readable after the swap', () => {
    const normalized = normalizeBase(twoLanguageData, ctx)
    for (const locale of ['nl', 'en', 'fr']) {
      expect(readLocale(normalized, locale, ctx)).toEqual(
        readLocale(twoLanguageData, locale, ctx),
      )
    }
  })

  it('leaves the main language missing when it has no translation', () => {
    const data = {
      $locale: 'en',
      title: 'Backend developer',
      salary: 4000,
      $i18n: { fr: { title: 'Développeur backend' } },
    }
    const normalized = normalizeBase(data, ctx)
    expect(normalized).toEqual({
      salary: 4000,
      $i18n: {
        en: { title: 'Backend developer' },
        fr: { title: 'Développeur backend' },
      },
    })
    expect(readLocale(normalized, 'nl', ctx)).toEqual({ salary: 4000 })
    // The shared salary counts as started for the base language.
    expect(localeStatus(normalized, 'nl', ctx)).toEqual({
      started: true,
      complete: false,
      missing: ['title', 'body'],
    })
  })

  it('is idempotent', () => {
    const once = normalizeBase(twoLanguageData, ctx)
    expect(normalizeBase(once, ctx)).toBe(once)
  })

  it('keeps every language readable when the main language changes and changes back', () => {
    const normalized = normalizeBase(twoLanguageData, ctx)
    // Main moves to en: the nl base is stamped, then swapped back out.
    const enMain = { ...ctx, main: 'en' }
    const stamped = { ...normalized, $locale: 'nl' }
    const enBase = normalizeBase(stamped, enMain)
    expect(enBase.$locale).toBeUndefined()
    for (const locale of ['nl', 'en', 'fr']) {
      expect(readLocale(enBase, locale, enMain)).toEqual(
        readLocale(twoLanguageData, locale, ctx),
      )
    }
    // Main moves back to nl: the en base is stamped, then swapped back out.
    const nlAgain = normalizeBase({ ...enBase, $locale: 'en' }, ctx)
    expect(nlAgain).toEqual(normalized)
  })

  it('does not mutate the input', () => {
    const snapshot = structuredClone(twoLanguageData)
    normalizeBase(twoLanguageData, ctx)
    expect(twoLanguageData).toEqual(snapshot)
  })
})

describe('servedLocales', () => {
  it('lists complete languages in site order, including main only when complete', () => {
    const data = {
      title: 'Titel',
      body: doc('Tekst'),
      $i18n: {
        en: { title: 'Title', body: doc('Text') },
        fr: { title: 'Titre' },
      },
    }
    expect(servedLocales(data, ctx)).toEqual(['nl', 'en'])
  })

  it('excludes main when its required fields are empty', () => {
    expect(servedLocales({ title: 'x' }, ctx)).toEqual([])
  })
})

describe('resolveChain', () => {
  it('returns an exact match without fallback', () => {
    expect(resolveChain('en', ['nl', 'en'], ctx)).toEqual({
      locale: 'en',
      isFallback: false,
    })
  })

  it('matches tags case-insensitively', () => {
    expect(resolveChain('EN', ['nl', 'en'], ctx)).toEqual({
      locale: 'en',
      isFallback: false,
    })
  })

  it('falls back from a region tag to its language subtag', () => {
    expect(resolveChain('nl-BE', ['nl', 'en'], ctx)).toEqual({
      locale: 'nl',
      isFallback: true,
    })
  })

  it('falls back to the main language next', () => {
    expect(resolveChain('fr', ['nl', 'en'], ctx)).toEqual({
      locale: 'nl',
      isFallback: true,
    })
  })

  it('falls back to the first available language in site order last', () => {
    expect(resolveChain('de', ['fr', 'en'], ctx)).toEqual({
      locale: 'en',
      isFallback: true,
    })
  })

  it('returns null when nothing is available', () => {
    expect(resolveChain('en', [], ctx)).toBeNull()
  })

  it('uses main without fallback when no language was requested', () => {
    expect(resolveChain(undefined, ['nl', 'en'], ctx)).toEqual({
      locale: 'nl',
      isFallback: false,
    })
    expect(resolveChain(null, ['en'], ctx)).toEqual({
      locale: 'en',
      isFallback: true,
    })
  })

  it('never serves a language that is no longer in the site list', () => {
    expect(resolveChain('de', ['de', 'fr'], ctx)).toEqual({
      locale: 'fr',
      isFallback: true,
    })
  })
})
