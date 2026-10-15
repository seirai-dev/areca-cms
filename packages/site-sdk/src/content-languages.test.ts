import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArecaClient } from './client.js'
import { createContent } from './content.js'
import { pullContent, readContentManifest } from './pull.js'
import type { SeoMeta, Snapshot } from './types.js'

// Generated shape: camel keys, raw `key` kept for the CMS. Mirrors areca.gen.ts.
const schema = {
  vacancies: {
    key: 'vacancies',
    label: 'Vacancies',
    route: '/vacancies/$slug',
    routes: { nl: '/vacatures/$slug' },
    requiredLanguages: ['en'],
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
      title: { key: 'title', type: 'text', required: true, translatable: true },
      jobType: { key: 'job-type', type: 'text', required: false, translatable: true },
      salary: { key: 'salary', type: 'number', required: false },
    },
  },
  pages: {
    key: 'pages',
    route: '/$slug',
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
    },
  },
} as const

const globalSchema = {
  homePage: {
    key: 'home-page',
    label: 'Home page',
    seo: true,
    fields: {
      headline: { key: 'headline', type: 'text', required: true, translatable: true },
      phone: { key: 'phone', type: 'text', required: false },
    },
  },
} as const

const LANGUAGES = { main: 'nl', all: ['nl', 'en', 'fr'] }

const SEO = { title: 'Welkom' } as unknown as SeoMeta

/** Raw CMS shape, as published with languages. */
function rawSnapshot(): Snapshot {
  return {
    publicationId: 'pub-1',
    siteKey: 'site',
    createdAt: '2026-03-01T00:00:00.000Z',
    hash: 'h1',
    languages: LANGUAGES,
    schema: {
      vacancies: {
        route: '/vacancies/$slug',
        routes: { nl: '/vacatures/$slug' },
        requiredLanguages: ['en'],
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
          { key: 'job-type', label: 'Job type', type: 'text', translatable: true },
          { key: 'salary', label: 'Salary', type: 'number' },
        ],
      },
      pages: {
        route: '/$slug',
        fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
      },
    },
    collections: {
      vacancies: [
        // Complete in nl and en. Shown in nl by default.
        {
          id: 'v1',
          slug: 'backend-ontwikkelaar',
          publishedAt: '2026-03-01T07:00:00.000Z',
          locale: 'nl',
          data: {
            slug: 'backend-ontwikkelaar',
            title: 'Backend ontwikkelaar',
            'job-type': 'fulltime',
            salary: 4000,
          },
          locales: {
            nl: {
              slug: 'backend-ontwikkelaar',
              data: {
                slug: 'backend-ontwikkelaar',
                title: 'Backend ontwikkelaar',
                'job-type': 'fulltime',
                salary: 4000,
              },
            },
            en: {
              slug: 'backend-developer',
              data: {
                slug: 'backend-developer',
                title: 'Backend developer',
                'job-type': 'fulltime',
                salary: 4000,
              },
            },
          },
        },
        // Only nl is complete. English visitors get the main language.
        {
          id: 'v2',
          slug: 'frontend',
          publishedAt: '2026-03-02T07:00:00.000Z',
          locale: 'nl',
          data: { slug: 'frontend', title: 'Frontend ontwikkelaar', salary: 3000 },
          locales: {
            nl: {
              slug: 'frontend',
              data: { slug: 'frontend', title: 'Frontend ontwikkelaar', salary: 3000 },
            },
          },
        },
        // Base language is English (nl is not complete). Served by the chain.
        {
          id: 'v3',
          slug: 'designer',
          publishedAt: '2026-03-03T07:00:00.000Z',
          locale: 'en',
          data: { slug: 'designer', title: 'Designer', salary: null },
          locales: {
            en: {
              slug: 'designer',
              data: { slug: 'designer', title: 'Designer', salary: null },
            },
            fr: {
              slug: 'designeur',
              data: { slug: 'designeur', title: 'Designeur', salary: null },
            },
          },
        },
      ],
      pages: [
        { id: 'p1', slug: 'over-ons', publishedAt: null, data: { slug: 'over-ons' } },
      ],
    },
    globals: {
      'home-page': {
        id: 'g1',
        publishedAt: '2026-03-01T00:00:00.000Z',
        locale: 'nl',
        data: { headline: 'Welkom', phone: '010' },
        seo: SEO,
        locales: {
          nl: { data: { headline: 'Welkom', phone: '010' }, seo: SEO },
          en: {
            data: { headline: 'Welcome', phone: '010' },
            seo: { title: 'Welcome' } as unknown as SeoMeta,
          },
        },
      },
    },
    globalSchema: {
      'home-page': {
        label: 'Home page',
        seo: true,
        fields: [
          { key: 'headline', label: 'Headline', type: 'text', required: true, translatable: true },
          { key: 'phone', label: 'Phone', type: 'text' },
        ],
      },
    },
  }
}

const directories: string[] = []
const previousFetch = globalThis.fetch
const previousPin = process.env.ARECA_SNAPSHOT_ID
const previousCwd = process.cwd()
let served: { snapshot?: unknown; preview?: unknown } = {}
let previewRequests: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  globalThis.fetch = previousFetch
  process.chdir(previousCwd)
  served = {}
  previewRequests = []
  if (previousPin === undefined) delete process.env.ARECA_SNAPSHOT_ID
  else process.env.ARECA_SNAPSHOT_ID = previousPin
})

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'areca-languages-'))
  directories.push(value)
  return value
}

/** Serves the CMS endpoints the SDK calls, from `served`. */
function fakeCms() {
  delete process.env.ARECA_SNAPSHOT_ID
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/sites/snapshot/current') {
      return Response.json(served.snapshot)
    }
    if (url.pathname === '/api/sites/preview') {
      previewRequests.push(url.search)
      return Response.json(served.preview)
    }
    return new Response('not found', { status: 404 })
  }
}

function clientFor() {
  return createArecaClient({ cmsUrl: 'https://cms.test', siteToken: 'site-token' })
}

async function publish(outDir: string, snapshot: Snapshot) {
  fakeCms()
  served.snapshot = snapshot
  return pullContent({ outDir, client: clientFor() })
}

async function setup(snapshot: Snapshot = rawSnapshot()) {
  const outDir = directory()
  await publish(outDir, snapshot)
  return {
    outDir,
    content: createContent({ schema, globalSchema, dir: outDir }),
  }
}

function slugs(entries: { slug: string }[]): string[] {
  return entries.map((entry) => entry.slug)
}

describe('languages: pull and manifest', () => {
  it('persists the snapshot languages in the manifest', async () => {
    const { outDir } = await setup()
    expect(readContentManifest(outDir).languages).toEqual(LANGUAGES)
  })

  it('writes no languages to the manifest of a single-language publication', async () => {
    const outDir = directory()
    const { languages: _languages, ...single } = rawSnapshot()
    await publish(outDir, single)
    expect(readContentManifest(outDir).languages).toBeUndefined()
  })

  it('rejects a translation whose data breaks the schema, naming the language', async () => {
    const snapshot = rawSnapshot()
    const broken = snapshot.collections.vacancies![0]!
    broken.locales!.en!.data = { slug: 'backend-developer', 'job-type': 'fulltime' }
    await expect(setup(snapshot)).rejects.toThrow(/vacancies\/backend-ontwikkelaar\.en\.title/)
  })

  it('camelizes the data of every language', async () => {
    const { content } = await setup()
    const entry = content.vacancies.get('backend-developer', { locale: 'en' })
    expect(entry?.data.jobType).toBe('fulltime')
    expect(entry?.data).not.toHaveProperty('job-type')
  })
})

describe('languages: default language and fallback chain', () => {
  it('serves the main language by default, falling back per entry', async () => {
    const { content } = await setup()
    const all = content.vacancies.all()
    expect(all.map((entry) => [entry.slug, entry.locale, entry.isFallback])).toEqual([
      ['backend-ontwikkelaar', 'nl', false],
      ['frontend', 'nl', false],
      // Base language is en and nl is not available: first in site order.
      ['designer', 'en', true],
    ])
  })

  it('serves the translation of the requested language, falling back to main', async () => {
    const { content } = await setup()
    const all = content.vacancies.all({ locale: 'en' })
    expect(all.map((entry) => [entry.slug, entry.data.title, entry.locale, entry.isFallback])).toEqual([
      ['backend-developer', 'Backend developer', 'en', false],
      ['frontend', 'Frontend ontwikkelaar', 'nl', true],
      ['designer', 'Designer', 'en', false],
    ])
  })

  it('uses the language subtag when the exact tag is missing (fr-BE to fr)', async () => {
    const { content } = await setup()
    const served = content.vacancies.all({ locale: 'fr-BE' as never }).map((entry) => [entry.locale, entry.isFallback])
    // v1 has no fr and no fr-BE: main. v3 has fr: the subtag matches it.
    expect(served).toEqual([
      ['nl', true],
      ['nl', true],
      ['fr', true],
    ])
  })

  it('matches the requested tag case-insensitively without falling back', async () => {
    const { content } = await setup()
    const [entry] = content.vacancies.all({ locale: 'EN' as never })
    expect(entry?.locale).toBe('en')
    expect(entry?.isFallback).toBe(false)
  })

  it('takes the first language in site order when neither the request nor main exists', async () => {
    const { content } = await setup()
    // designer has en and fr; site order is nl, en, fr, so en wins.
    const designer = content.vacancies.get('designer', { locale: 'de' as never })
    expect(designer?.locale).toBe('en')
    expect(designer?.isFallback).toBe(true)
  })

  it('excludes entries whose requested language is not available when fallback is false', async () => {
    const { content } = await setup()
    expect(slugs(content.vacancies.all({ locale: 'en', fallback: false }))).toEqual([
      'backend-developer',
      'designer',
    ])
    expect(slugs(content.vacancies.all({ locale: 'fr', fallback: false }))).toEqual(['designeur'])
  })

  it('keeps fallback on by default', async () => {
    const { content } = await setup()
    expect(slugs(content.vacancies.all({ locale: 'fr' }))).toEqual([
      'backend-ontwikkelaar',
      'frontend',
      'designeur',
    ])
  })
})

describe('languages: where, orderBy and limit on the resolved view', () => {
  it('filters on the translated title', async () => {
    const { content } = await setup()
    expect(
      slugs(content.vacancies.all({ locale: 'en', where: { title: { contains: 'developer' } } })),
    ).toEqual(['backend-developer'])
  })

  it('sorts on the translated title', async () => {
    const { content } = await setup()
    expect(slugs(content.vacancies.all({ locale: 'nl', orderBy: { title: 'asc' } }))).toEqual([
      'backend-ontwikkelaar',
      'designer',
      'frontend',
    ])
  })

  it('applies fallback before the where clause', async () => {
    const { content } = await setup()
    // frontend is served as nl when asked for en, so it matches a nl title.
    expect(
      slugs(content.vacancies.all({ locale: 'en', where: { title: 'Frontend ontwikkelaar' } })),
    ).toEqual(['frontend'])
  })
})

describe('languages: get, first and byId', () => {
  it('matches the slug of the resolved language', async () => {
    const { content } = await setup()
    expect(content.vacancies.get('backend-developer', { locale: 'en' })?.id).toBe('v1')
    expect(content.vacancies.get('backend-developer')).toBeUndefined()
    expect(content.vacancies.get('backend-ontwikkelaar')?.id).toBe('v1')
  })

  it('also tries the main slug when fallback is on', async () => {
    const { content } = await setup()
    const entry = content.vacancies.get('backend-ontwikkelaar', { locale: 'en' })
    expect(entry?.id).toBe('v1')
    expect(entry?.locale).toBe('en')
    expect(entry?.slug).toBe('backend-developer')
  })

  it('does not try the main slug when fallback is false', async () => {
    const { content } = await setup()
    expect(
      content.vacancies.get('backend-ontwikkelaar', { locale: 'en', fallback: false }),
    ).toBeUndefined()
  })

  it('returns a fallback entry by its main slug', async () => {
    const { content } = await setup()
    expect(content.vacancies.get('frontend', { locale: 'en' })?.locale).toBe('nl')
  })

  it('finds by id in the requested language and honours fallback', async () => {
    const { content } = await setup()
    expect(content.vacancies.byId('v2', { locale: 'en' })?.locale).toBe('nl')
    expect(content.vacancies.byId('v2', { locale: 'en', fallback: false })).toBeUndefined()
    expect(content.vacancies.first({ locale: 'fr' })?.slug).toBe('backend-ontwikkelaar')
  })
})

describe('languages: scoped views and resolvers', () => {
  it('in(locale) reads every method in that language', async () => {
    const { content } = await setup()
    const en = content.in('en')
    expect(slugs(en.vacancies.all())).toEqual(['backend-developer', 'frontend', 'designer'])
    expect(en.vacancies.get('backend-developer')?.locale).toBe('en')
    expect(en.globals.homePage.headline).toBe('Welcome')
  })

  it('a per-call locale beats the scope', async () => {
    const { content } = await setup()
    expect(slugs(content.in('en').vacancies.all({ locale: 'nl' }))).toEqual([
      'backend-ontwikkelaar',
      'frontend',
      'designer',
    ])
  })

  it('a resolver is used when there is no scope or per-call locale', async () => {
    const outDir = directory()
    await publish(outDir, rawSnapshot())
    const content = createContent({ schema, globalSchema, dir: outDir, locale: () => 'fr' })
    expect(content.vacancies.first()?.locale).toBe('nl')
    expect(slugs(content.vacancies.all())).toEqual([
      'backend-ontwikkelaar',
      'frontend',
      'designeur',
    ])
    expect(content.in('en').vacancies.first()?.slug).toBe('backend-developer')
  })

  it('a resolver that returns nothing means the main language', async () => {
    const outDir = directory()
    await publish(outDir, rawSnapshot())
    const content = createContent({ schema, globalSchema, dir: outDir, locale: () => undefined })
    expect(content.vacancies.first()?.slug).toBe('backend-ontwikkelaar')
  })

  it('a string resolver is accepted', async () => {
    const outDir = directory()
    await publish(outDir, rawSnapshot())
    const content = createContent({ schema, globalSchema, dir: outDir, locale: 'en' })
    expect(content.vacancies.first()?.slug).toBe('backend-developer')
  })

  it('keeps the scope for references and href', async () => {
    const { content } = await setup()
    const en = content.in('en')
    expect(en.resolve({ collection: 'vacancies', id: 'v1', slug: 'x' })?.slug).toBe(
      'backend-developer',
    )
    expect(en.href({ collection: 'vacancies', id: 'v1', slug: 'x' })).toBe(
      '/vacancies/backend-developer',
    )
  })
})

describe('languages: resolve and href', () => {
  it('resolves a reference by id in the active language', async () => {
    const { content } = await setup()
    expect(content.resolve({ collection: 'vacancies', id: 'v1', slug: 'backend-ontwikkelaar' })?.locale).toBe('nl')
    expect(
      content.in('en').resolve({ collection: 'vacancies', id: 'v1', slug: 'backend-ontwikkelaar' })?.slug,
    ).toBe('backend-developer')
  })

  it('builds href from the entry language and its route pattern', async () => {
    const { content } = await setup()
    const v1 = content.vacancies.get('backend-ontwikkelaar')!
    expect(content.vacancies.href(v1)).toBe('/vacatures/backend-ontwikkelaar')
    const v1en = content.vacancies.get('backend-developer', { locale: 'en' })!
    expect(content.vacancies.href(v1en)).toBe('/vacancies/backend-developer')
    const v2en = content.vacancies.get('frontend', { locale: 'en' })!
    expect(content.vacancies.href(v2en)).toBe('/vacatures/frontend')
  })

  it('uses the pattern of the language for a string slug', async () => {
    const { content } = await setup()
    expect(content.vacancies.href('frontend')).toBe('/vacatures/frontend')
    expect(content.in('en').vacancies.href('designer')).toBe('/vacancies/designer')
  })

  it('reports the alternates of each available language', async () => {
    const { content } = await setup()
    expect(content.vacancies.get('backend-ontwikkelaar')?.alternates).toEqual({
      nl: '/vacatures/backend-ontwikkelaar',
      en: '/vacancies/backend-developer',
    })
    expect(content.vacancies.get('frontend')?.alternates).toEqual({
      nl: '/vacatures/frontend',
    })
    expect(content.vacancies.get('designer')?.alternates).toEqual({
      en: '/vacancies/designer',
      fr: '/vacancies/designeur',
    })
  })

  it('lists the available languages of each entry', async () => {
    const { content } = await setup()
    expect(content.vacancies.get('backend-ontwikkelaar')?.locales).toEqual(['nl', 'en'])
    expect(content.vacancies.get('frontend')?.locales).toEqual(['nl'])
  })
})

describe('languages: entries without translations', () => {
  it('serves a single-language site with und, no locales and no alternates', async () => {
    const outDir = directory()
    const { languages: _languages, ...single } = rawSnapshot()
    await publish(outDir, single)
    const content = createContent({ schema, globalSchema, dir: outDir })
    const page = content.pages.get('over-ons')
    expect(page?.locale).toBe('und')
    expect(page?.isFallback).toBe(false)
    expect(page?.locales).toEqual([])
    expect(page?.alternates).toEqual({})
    expect(content.languages).toBeNull()
  })

  it('serves an entry without locales in the main language on a site with languages', async () => {
    const { content } = await setup()
    const page = content.pages.get('over-ons', { locale: 'en' })
    expect(page?.locale).toBe('nl')
    expect(page?.isFallback).toBe(true)
    expect(page?.alternates).toEqual({ nl: '/over-ons' })
  })
})

describe('languages: globals', () => {
  it('returns $locale and $isFallback with the values', async () => {
    const { content } = await setup()
    expect(content.globals.homePage).toMatchObject({
      headline: 'Welkom',
      phone: '010',
      $locale: 'nl',
      $isFallback: false,
    })
  })

  it('serves the language of the scope and marks fallbacks', async () => {
    const { content } = await setup()
    expect(content.in('en').globals.homePage).toMatchObject({
      headline: 'Welcome',
      $locale: 'en',
      $isFallback: false,
      $seo: { title: 'Welcome' },
    })
    expect(content.in('fr').globals.homePage).toMatchObject({
      headline: 'Welkom',
      $locale: 'nl',
      $isFallback: true,
    })
  })
})

describe('languages: site-level helpers', () => {
  it('exposes the site languages', async () => {
    const { content } = await setup()
    expect(content.languages).toEqual(LANGUAGES)
  })

  it('negotiates a locale per the fallback chain', async () => {
    const { content } = await setup()
    expect(content.matchLocale('fr-BE')).toBe('fr')
    expect(content.matchLocale('en')).toBe('en')
    expect(content.matchLocale('de')).toBe('nl')
    expect(content.matchLocale('de, en-US;q=0.5')).toBe('en')
    expect(content.matchLocale(undefined)).toBe('nl')
  })

  it('reserves languages, matchLocale and in as collection names', () => {
    for (const name of ['languages', 'matchLocale', 'in']) {
      const bad = { [name]: { route: '/x/$slug', fields: {} } } as never
      expect(() => createContent({ schema: bad, dir: 'x' })).toThrow(/reserved/)
    }
  })
})

describe('languages: preview', () => {
  it('passes the active locale to the preview endpoint', async () => {
    const { content } = await setup()
    served.preview = {
      kind: 'entry',
      collection: 'vacancies',
      slug: 'backend-developer',
      entry: {
        id: 'v1',
        slug: 'backend-developer',
        publishedAt: null,
        locale: 'en',
        data: { slug: 'backend-developer', title: 'Draft', 'job-type': 'fulltime' },
      },
    }
    const preview = await content.in('en').preview('tok', { client: clientFor() })
    expect(previewRequests).toEqual(['?token=tok&locale=en'])
    expect(preview.entry.locale).toBe('en')
    expect(preview.collection).toBe('vacancies')
    expect(preview.entry.data).toMatchObject({ title: 'Draft' })
  })

  it('sends no locale when none is active', async () => {
    const { content } = await setup()
    served.preview = {
      kind: 'entry',
      collection: 'vacancies',
      slug: 'backend-developer',
      entry: { id: 'v1', slug: 'backend-developer', publishedAt: null, data: { slug: 'backend-developer', title: 'Draft' } },
    }
    await content.preview('tok', { client: clientFor() })
    expect(previewRequests).toEqual(['?token=tok'])
  })

  it('passes the locale of previewGlobals to the preview endpoint', async () => {
    const { content } = await setup()
    served.preview = {
      kind: 'global',
      global: 'home-page',
      entry: { id: 'g1', publishedAt: null, locale: 'en', data: { headline: 'Draft', phone: '010' } },
    }
    const result = await content.in('en').previewGlobals('tok', { client: clientFor() })
    expect(previewRequests).toEqual(['?token=tok&locale=en'])
    expect(result.globals.homePage).toMatchObject({ headline: 'Draft', $locale: 'en' })
  })
})
