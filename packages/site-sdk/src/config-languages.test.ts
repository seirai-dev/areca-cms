import { describe, expect, it } from 'vitest'
import { defineSiteContent, manifestFromConfig } from './config.js'
import { diffManifests } from './manifest-pull.js'
import type { SiteContentConfig } from './types.js'

function config(overrides: Partial<SiteContentConfig> = {}): SiteContentConfig {
  return {
    siteKey: 'acme',
    collections: {
      vacancies: {
        route: '/vacancies/$slug',
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
          { key: 'salary', label: 'Salary', type: 'number', translatable: false },
        ],
      },
    },
    ...overrides,
  }
}

const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

describe('manifestFromConfig: languages', () => {
  it('sends languages, routes, requiredLanguages and translatable', () => {
    const manifest = manifestFromConfig(
      config({
        languages,
        globals: {
          homePage: {
            fields: [{ key: 'headline', label: 'Headline', type: 'text', translatable: true }],
            requiredLanguages: ['en'],
          },
        },
        collections: {
          vacancies: {
            route: '/vacancies/$slug',
            routes: { nl: '/vacatures/$slug' },
            requiredLanguages: ['en'],
            fields: [
              { key: 'slug', label: 'Slug', type: 'slug', required: true },
              { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
            ],
          },
        },
      }),
    )
    expect(manifest.languages).toEqual(languages)
    expect(manifest.collections.vacancies).toMatchObject({
      routes: { nl: '/vacatures/$slug' },
      requiredLanguages: ['en'],
    })
    expect(manifest.collections.vacancies!.fields[1]).toMatchObject({ translatable: true })
    expect(manifest.globals!.homePage).toMatchObject({ requiredLanguages: ['en'] })
  })

  it('never sends i18n, which is SDK-only', () => {
    const manifest = manifestFromConfig(
      config({ languages, i18n: { paraglide: './src/paraglide/runtime.js' } }),
    )
    expect(manifest).not.toHaveProperty('i18n')
  })

  it('leaves languages out when the config does not set them', () => {
    const manifest = manifestFromConfig(config())
    expect(manifest).not.toHaveProperty('languages')
    expect(manifest.collections.vacancies).not.toHaveProperty('routes')
    expect(manifest.collections.vacancies).not.toHaveProperty('requiredLanguages')
  })

  it('accepts a language with a region and a language with a script', () => {
    expect(() =>
      manifestFromConfig(config({ languages: { main: 'nl-BE', all: ['nl-BE', 'zh-Hant-TW'] } })),
    ).not.toThrow()
  })

  it('rejects an invalid BCP 47 tag', () => {
    expect(() =>
      manifestFromConfig(config({ languages: { main: 'nl', all: ['nl', 'not a tag'] } })),
    ).toThrow(/Invalid language tag "not a tag"/)
  })

  it('rejects duplicate languages, including case-only duplicates', () => {
    expect(() =>
      manifestFromConfig(config({ languages: { main: 'nl', all: ['nl', 'en', 'NL'] } })),
    ).toThrow(/duplicate/i)
  })

  it('requires the main language in all', () => {
    expect(() =>
      manifestFromConfig(config({ languages: { main: 'de', all: ['nl', 'en'] } })),
    ).toThrow(/main language "de" must be listed in languages.all/)
  })

  it('requires routes keys to be in languages.all', () => {
    expect(() =>
      manifestFromConfig(
        config({
          languages,
          collections: {
            vacancies: {
              route: '/vacancies/$slug',
              routes: { de: '/stellen/$slug' },
              fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
            },
          },
        }),
      ),
    ).toThrow(/routes of collection "vacancies" language "de" is not in languages.all/)
  })

  it('requires requiredLanguages to be in languages.all', () => {
    expect(() =>
      manifestFromConfig(
        config({
          languages,
          collections: {
            vacancies: {
              route: '/vacancies/$slug',
              requiredLanguages: ['es'],
              fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
            },
          },
        }),
      ),
    ).toThrow(/requiredLanguages of collection "vacancies" language "es" is not in languages.all/)
  })

  it('rejects language settings on a collection when no languages are configured', () => {
    expect(() =>
      manifestFromConfig(
        config({
          collections: {
            vacancies: {
              route: '/vacancies/$slug',
              requiredLanguages: ['en'],
              fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
            },
          },
        }),
      ),
    ).toThrow(/Set languages in the config first/)
  })

  it('requires a route pattern per language to contain $slug', () => {
    expect(() =>
      manifestFromConfig(
        config({
          languages,
          collections: {
            vacancies: {
              route: '/vacancies/$slug',
              routes: { en: '/jobs' },
              fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
            },
          },
        }),
      ),
    ).toThrow(/must contain \$slug/)
  })
})

describe('defineSiteContent: languages', () => {
  it('returns languages, i18n and the new collection and field options', () => {
    const site = defineSiteContent({
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
    })
    expect(site.languages).toEqual({ main: 'nl', all: ['nl', 'en'] })
    expect(site.i18n).toEqual({ paraglide: './src/paraglide/runtime.js' })
  })
})

describe('manifest diff with languages', () => {
  it('reports a change when only a route pattern differs', () => {
    const local = config({
      languages,
      collections: {
        vacancies: {
          route: '/vacancies/$slug',
          routes: { nl: '/vacatures/$slug' },
          fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
        },
      },
    })
    const remote = manifestFromConfig(local)
    remote.collections.vacancies!.routes = { nl: '/banen/$slug' }
    expect(diffManifests(local, remote).changed).toEqual(['vacancies'])
  })
})
