/**
 * Contract test: a publication shaped exactly as the CMS ships it with content
 * languages (see apps/cms/src/server/content/snapshot-languages.test.ts) goes
 * through `pullContent` and `createContent`. If the CMS wire shape and the SDK
 * types drift, this file fails.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArecaClient } from './client.js'
import { createContent } from './content.js'
import { getPreviewEntry } from './preview.js'
import { pullContent } from './pull.js'
import type { SeoMeta, Snapshot } from './types.js'

// Generated shape, as areca.gen.ts describes it: camel members, raw `key`.
const schema = {
  vacancies: {
    key: 'vacancies',
    label: 'Vacancies',
    route: '/vacancies/$slug',
    routes: { en: '/jobs/$slug' },
    requiredLanguages: ['en'],
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
      title: { key: 'title', type: 'text', required: true, translatable: true },
      summary: { key: 'summary', type: 'textarea', required: false, translatable: true },
      salary: { key: 'salary', type: 'number', required: false },
      heroImage: { key: 'heroImage', type: 'image', required: false },
    },
  },
} as const

const globalSchema = {
  homePage: {
    key: 'homePage',
    label: 'Home page',
    seo: true,
    fields: {
      headline: { key: 'headline', type: 'text', required: true, translatable: true },
      phone: { key: 'phone', type: 'text', required: false },
    },
  },
} as const

function seo(title: string, description: string | null = null): SeoMeta {
  return {
    title,
    description,
    canonicalUrl: null,
    robots: { index: true, follow: true, content: 'index, follow' },
    focusKeyphrase: null,
    openGraph: {
      type: 'article',
      title,
      description,
      url: null,
      siteName: 'Acme',
      image: null,
      publishedTime: null,
      modifiedTime: null,
    },
    twitter: { card: 'summary', title, description, image: null },
    author: null,
    summary: null,
    keyTakeaways: [],
    faq: [],
    about: [],
    jsonLd: [],
  }
}

/** Shape of `/api/sites/snapshot/current`, as the CMS builds it for languages. */
function cmsSnapshot(): Snapshot {
  return {
    publicationId: 'pub-cms-1',
    siteKey: 'acme',
    createdAt: '2026-10-15T08:00:00.000Z',
    hash: 'sha256-contract',
    languages: { main: 'nl', all: ['nl', 'en', 'fr'] },
    siteUrl: 'https://acme.test',
    assets: [],
    schema: {
      vacancies: {
        route: '/vacancies/$slug',
        routes: { en: '/jobs/$slug' },
        requiredLanguages: ['en'],
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
          { key: 'summary', label: 'Summary', type: 'textarea', translatable: true },
          { key: 'salary', label: 'Salary', type: 'number' },
          { key: 'heroImage', label: 'Hero image', type: 'image' },
        ],
      },
    },
    collections: {
      vacancies: [
        // Main language nl, en complete, fr incomplete (never shipped).
        {
          id: 'entry-1',
          slug: 'backend-ontwikkelaar',
          publishedAt: '2026-10-14T10:00:00.000Z',
          locale: 'nl',
          data: {
            slug: 'backend-ontwikkelaar',
            title: 'Backend ontwikkelaar',
            summary: 'Nederlandse samenvatting',
            salary: 4000,
            heroImage: {
              url: 'https://cms.test/api/assets/file/org/hero.png',
              width: 10,
              height: 10,
              alt: 'Dutch alt',
              mimeType: 'image/png',
            },
          },
          seo: seo('Backend ontwikkelaar', 'Nederlandse beschrijving'),
          locales: {
            nl: {
              slug: 'backend-ontwikkelaar',
              data: {
                slug: 'backend-ontwikkelaar',
                title: 'Backend ontwikkelaar',
                summary: 'Nederlandse samenvatting',
                salary: 4000,
                heroImage: {
                  url: 'https://cms.test/api/assets/file/org/hero.png',
                  width: 10,
                  height: 10,
                  alt: 'Dutch alt',
                  mimeType: 'image/png',
                },
              },
              seo: seo('Backend ontwikkelaar', 'Nederlandse beschrijving'),
            },
            en: {
              slug: 'backend-developer',
              data: {
                slug: 'backend-developer',
                title: 'Backend developer',
                summary: 'English summary',
                salary: 4000,
                heroImage: {
                  url: 'https://cms.test/api/assets/file/org/hero.png',
                  width: 10,
                  height: 10,
                  alt: 'English alt',
                  mimeType: 'image/png',
                },
              },
              seo: seo('Backend developer', 'English description'),
            },
          },
        },
        // Only nl is complete: English visitors get the main language.
        {
          id: 'entry-2',
          slug: 'frontend',
          publishedAt: '2026-10-13T10:00:00.000Z',
          locale: 'nl',
          data: { slug: 'frontend', title: 'Frontend ontwikkelaar', salary: 3000 },
          locales: {
            nl: {
              slug: 'frontend',
              data: { slug: 'frontend', title: 'Frontend ontwikkelaar', salary: 3000 },
            },
          },
        },
      ],
    },
    globals: {
      homePage: {
        id: 'global-1',
        publishedAt: '2026-10-14T09:00:00.000Z',
        locale: 'nl',
        data: { headline: 'Welkom', phone: '010' },
        seo: seo('Welkom'),
        locales: {
          nl: { data: { headline: 'Welkom', phone: '010' }, seo: seo('Welkom') },
          en: { data: { headline: 'Welcome', phone: '010' }, seo: seo('Welcome') },
        },
      },
    },
    globalSchema: {
      homePage: {
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

afterEach(() => {
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  globalThis.fetch = previousFetch
  if (previousPin === undefined) delete process.env.ARECA_SNAPSHOT_ID
  else process.env.ARECA_SNAPSHOT_ID = previousPin
})

function fakeCms(responses: { snapshot?: unknown; preview?: unknown; previewQueries?: string[] }) {
  delete process.env.ARECA_SNAPSHOT_ID
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/sites/snapshot/current') return Response.json(responses.snapshot)
    if (url.pathname === '/api/sites/preview') {
      responses.previewQueries?.push(url.search)
      return Response.json(responses.preview)
    }
    return new Response('not found', { status: 404 })
  }
}

function clientFor() {
  return createArecaClient({ cmsUrl: 'https://cms.test', siteToken: 'site-token' })
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'areca-cms-contract-'))
  directories.push(dir)
  fakeCms({ snapshot: cmsSnapshot() })
  await pullContent({ outDir: dir, client: clientFor() })
  return createContent({ schema, globalSchema, dir })
}

describe('CMS languages snapshot through the SDK', () => {
  it('exposes the site languages', async () => {
    const content = await setup()
    expect(content.languages).toEqual({ main: 'nl', all: ['nl', 'en', 'fr'] })
  })

  it('serves the main language by default and reports the chain', async () => {
    const content = await setup()
    const [backend, frontend] = content.vacancies.all()
    expect(backend!.slug).toBe('backend-ontwikkelaar')
    expect(backend!.locale).toBe('nl')
    expect(backend!.isFallback).toBe(false)
    expect(backend!.locales).toEqual(['nl', 'en'])
    expect(backend!.data.title).toBe('Backend ontwikkelaar')
    // Incomplete in en: served from the chain (main), flagged as fallback.
    expect(frontend!.locale).toBe('nl')
    expect(frontend!.locales).toEqual(['nl'])
  })

  it('serves the English view with its own slug, route and alt text', async () => {
    const content = await setup()
    const en = content.in('en').vacancies.all()
    const backend = en.find((e) => e.locale === 'en')!
    expect(backend.slug).toBe('backend-developer')
    expect(backend.data.title).toBe('Backend developer')
    expect(backend.data.summary).toBe('English summary')
    // Shared fields are the same in every language.
    expect(backend.data.salary).toBe(4000)
    expect(backend.data.heroImage).toMatchObject({ alt: 'English alt' })
    expect(backend.seo?.title).toBe('Backend developer')
    expect(backend.isFallback).toBe(false)
    expect(backend.alternates).toEqual({
      nl: '/vacancies/backend-ontwikkelaar',
      en: '/jobs/backend-developer',
    })
  })

  it('falls back to main with isFallback when the requested language is incomplete', async () => {
    const content = await setup()
    const frontend = content.in('en').vacancies.all().find((e) => e.slug === 'frontend')!
    expect(frontend.locale).toBe('nl')
    expect(frontend.isFallback).toBe(true)
    expect(frontend.data.title).toBe('Frontend ontwikkelaar')
  })

  it('excludes untranslated entries with fallback: false', async () => {
    const content = await setup()
    const slugs = content.vacancies.all({ locale: 'en', fallback: false }).map((e) => e.slug)
    expect(slugs).toEqual(['backend-developer'])
  })

  it('finds an entry by its per-language slug', async () => {
    const content = await setup()
    expect(content.vacancies.get('backend-developer', { locale: 'en' })?.data.title).toBe(
      'Backend developer',
    )
  })

  it('reads sections per language, with $locale and $isFallback meta', async () => {
    const content = await setup()
    expect(content.in('en').globals.homePage.headline).toBe('Welcome')
    expect(content.in('en').globals.homePage.$locale).toBe('en')
    expect(content.globals.homePage.$locale).toBe('nl')
    expect(content.globals.homePage.$isFallback).toBe(false)
  })

  it('negotiates Accept-Language against the site languages', async () => {
    const content = await setup()
    expect(content.matchLocale('en-GB, nl;q=0.5')).toBe('en')
    expect(content.matchLocale('fr')).toBe('fr')
    expect(content.matchLocale('de')).toBe('nl')
  })

  it('passes the locale and reads localeStatus in preview', async () => {
    const queries: string[] = []
    fakeCms({
      previewQueries: queries,
      preview: {
        kind: 'entry',
        collection: 'vacancies',
        slug: 'backend-ontwikkelaar',
        entry: {
          ...cmsSnapshot().collections.vacancies![0],
          locale: 'en',
          data: { slug: 'backend-developer', title: 'Backend developer' },
          localeStatus: {
            nl: { complete: true, missing: [] },
            en: { complete: true, missing: [] },
            fr: { complete: false, missing: ['Title'] },
          },
        },
      },
    })
    const result = await getPreviewEntry({
      token: 'preview-token',
      client: clientFor(),
      locale: 'en',
    })
    expect(queries).toEqual(['?token=preview-token&locale=en'])
    expect(result.kind).toBe('entry')
    if (result.kind !== 'entry' && result.kind !== undefined) return
    expect(result.entry.locale).toBe('en')
    expect(result.entry.localeStatus?.fr).toEqual({ complete: false, missing: ['Title'] })
  })
})
