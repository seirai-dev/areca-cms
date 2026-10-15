import { describe, expect, it } from 'vitest'
import { generateConfigSource } from './generate-config.js'
import type { SiteContentConfig } from './types.js'

const config: SiteContentConfig = {
  siteKey: 'acme',
  languages: { main: 'nl', all: ['nl', 'en', 'fr'] },
  i18n: { paraglide: './src/paraglide/runtime.js' },
  collections: {
    vacancies: {
      route: '/vacancies/$slug',
      routes: { nl: '/vacatures/$slug' },
      requiredLanguages: ['en'],
      fields: [
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
        { key: 'salary', label: 'Salary', type: 'number', translatable: false },
      ],
    },
  },
  globals: {
    homePage: {
      seo: true,
      requiredLanguages: ['en'],
      fields: [{ key: 'headline', label: 'Headline', type: 'text', translatable: true }],
    },
  },
}

describe('generateConfigSource: languages', () => {
  it('writes languages, routes, requiredLanguages and translatable', () => {
    const source = generateConfigSource(config)
    expect(source).toContain("  languages: { main: 'nl', all: ['nl', 'en', 'fr'] },")
    expect(source).toContain("      routes: {\n        nl: '/vacatures/$slug',\n      },")
    expect(source).toContain("      requiredLanguages: ['en'],")
    expect(source).toContain('        translatable: true,')
    expect(source).toContain("      requiredLanguages: ['en'],\n      fields: [")
  })

  it('writes i18n for the SDK codegen', () => {
    expect(generateConfigSource(config)).toContain("  i18n: { paraglide: './src/paraglide/runtime.js' },")
  })

  it('omits languages, routes and i18n when they are not set', () => {
    const source = generateConfigSource({ siteKey: 'acme', collections: {} })
    expect(source).not.toContain('languages')
    expect(source).not.toContain('i18n')
  })

  it('round-trips through manifestFromConfig and the generated module', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { loadConfig } = await import('./load-config.js')
    const { manifestFromConfig } = await import('./config.js')
    const dir = mkdtempSync(join(tmpdir(), 'areca-roundtrip-'))
    try {
      const source = generateConfigSource(config).replace(
        "import { defineSiteContent } from '@areca-cms/site-sdk'",
        'const defineSiteContent = (c) => c',
      )
      writeFileSync(join(dir, 'areca.config.mjs'), source)
      const loaded = await loadConfig('areca.config.mjs', dir)
      expect(manifestFromConfig(loaded)).toEqual(manifestFromConfig(config))
      expect(loaded.i18n).toEqual(config.i18n)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
