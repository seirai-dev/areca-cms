import { describe, expectTypeOf, it } from 'vitest'
import { defineSiteContent } from './config.js'
import { createContent } from './content.js'
import type { Content, Entry, Locale, SeoMeta } from './index.js'
import { matchLocale, seoHead } from './index.js'
import { schema } from './test-fixtures/schema.js'

// This file registers a language set. Other type tests in the program see it too, which is harmless: they never name a locale.
declare module './schema-types.js' {
  interface Register {
    languages: { readonly main: 'nl'; readonly all: readonly ['nl', 'en', 'fr'] }
  }
}

type S = typeof schema
declare const content: Content<S>
declare const seo: SeoMeta

describe('Locale', () => {
  it('is the registered language union', () => {
    expectTypeOf<Locale>().toEqualTypeOf<'nl' | 'en' | 'fr'>()
  })
})

describe('entries carry their language', () => {
  it('adds locale, isFallback, locales and alternates to every entry', () => {
    const post = content.blogPosts.first()!
    expectTypeOf(post.locale).toEqualTypeOf<Locale>()
    expectTypeOf(post.isFallback).toEqualTypeOf<boolean>()
    expectTypeOf(post.locales).toEqualTypeOf<Locale[]>()
    expectTypeOf(post.alternates).toEqualTypeOf<Partial<Record<Locale, string>>>()
  })

  it('keeps the existing entry type for the collection', () => {
    expectTypeOf(content.blogPosts.get('hello')).toEqualTypeOf<Entry<'blogPosts', S> | undefined>()
  })
})

describe('collection api: language options', () => {
  it('all() takes a locale and a fallback flag, and returns entries', () => {
    expectTypeOf(content.blogPosts.all({ locale: 'en', fallback: false })).toEqualTypeOf<
      Entry<'blogPosts', S>[]
    >()
    expectTypeOf(content.blogPosts.all({ locale: 'fr', where: { featured: true } })).toEqualTypeOf<
      Entry<'blogPosts', S>[]
    >()
  })

  it('first(), get() and byId() take the same options', () => {
    expectTypeOf(content.blogPosts.first({ locale: 'en' })).toEqualTypeOf<
      Entry<'blogPosts', S> | undefined
    >()
    expectTypeOf(content.blogPosts.get('hello', { locale: 'nl' })).toEqualTypeOf<
      Entry<'blogPosts', S> | undefined
    >()
    expectTypeOf(content.blogPosts.byId('id', { fallback: true })).toEqualTypeOf<
      Entry<'blogPosts', S> | undefined
    >()
  })

  it('rejects a language that is not registered and a non-boolean fallback', () => {
    // @ts-expect-error de is not a registered language
    content.blogPosts.all({ locale: 'de' })
    // @ts-expect-error fallback is a boolean
    content.blogPosts.all({ fallback: 'no' })
    // @ts-expect-error get() takes the locale options object, not a second slug
    content.blogPosts.get('hello', 'en')
  })
})

describe('content: languages and scopes', () => {
  it('in(locale) returns the same content shape', () => {
    expectTypeOf(content.in('en')).toEqualTypeOf<Content<S>>()
    // @ts-expect-error de is not a registered language
    content.in('de')
  })

  it('languages is the site languages or null', () => {
    expectTypeOf(content.languages).toEqualTypeOf<{ main: Locale; all: Locale[] } | null>()
  })

  it('matchLocale returns a registered language or undefined', () => {
    expectTypeOf(content.matchLocale('fr-BE')).toEqualTypeOf<Locale | undefined>()
  })

  it('preview takes an optional locale', () => {
    type Options = NonNullable<Parameters<typeof content.preview>[1]>
    expectTypeOf<Options['locale']>().toEqualTypeOf<Locale | undefined>()
  })

  it('createContent accepts a locale or a resolver', () => {
    expectTypeOf(createContent({ schema, dir: 'out', locale: 'en' })).toEqualTypeOf<Content<S>>()
    expectTypeOf(
      createContent({ schema, dir: 'out', locale: () => 'nl' }),
    ).toEqualTypeOf<Content<S>>()
  })
})

describe('globals: language meta', () => {
  it('carries $locale and $isFallback next to the values', () => {
    expectTypeOf(content.globals.companyInfo.$locale).toEqualTypeOf<Locale>()
    expectTypeOf(content.globals.companyInfo.$isFallback).toEqualTypeOf<boolean>()
  })
})

describe('matchLocale and seoHead', () => {
  it('matchLocale is pure and returns a registered language', () => {
    expectTypeOf(matchLocale('en', { main: 'nl', all: ['nl', 'en'] })).toEqualTypeOf<
      string | undefined
    >()
  })

  it('seoHead takes locale, alternates, main and siteUrl', () => {
    seoHead(seo, {
      locale: 'nl',
      alternates: { nl: '/nl', en: '/en' },
      main: 'nl',
      siteUrl: 'https://acme.nl',
    })
  })
})

describe('defineSiteContent: languages', () => {
  it('accepts languages, i18n, routes, requiredLanguages and translatable', () => {
    defineSiteContent({
      siteKey: 'acme',
      languages: { main: 'nl', all: ['nl', 'en'] },
      i18n: { paraglide: './src/paraglide/runtime.js' },
      collections: {
        vacancies: {
          route: '/vacancies/$slug',
          routes: { nl: '/vacatures/$slug' },
          requiredLanguages: ['en'],
          fields: [
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
            { key: 'title', label: 'Title', type: 'text', translatable: true },
          ],
        },
      },
      globals: {
        homePage: {
          requiredLanguages: ['en'],
          fields: [{ key: 'headline', label: 'Headline', type: 'text', translatable: false }],
        },
      },
    })
  })

  it('rejects a route pattern without $slug, a non-boolean translatable and an unknown i18n key', () => {
    defineSiteContent({
      siteKey: 'acme',
      collections: {
        vacancies: {
          // @ts-expect-error the route pattern must contain $slug
          routes: { nl: '/vacatures' },
          route: '/vacancies/$slug',
          fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
        },
      },
    })
    defineSiteContent({
      siteKey: 'acme',
      collections: {
        vacancies: {
          route: '/vacancies/$slug',
          fields: [
            // @ts-expect-error translatable is a boolean
            { key: 'title', label: 'Title', type: 'text', translatable: 'yes' },
          ],
        },
      },
    })
    defineSiteContent({
      siteKey: 'acme',
      collections: {},
      // @ts-expect-error i18n only supports paraglide
      i18n: { next: './x' },
    })
  })

})
