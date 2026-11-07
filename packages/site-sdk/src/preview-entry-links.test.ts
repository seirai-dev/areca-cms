import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createArecaClient } from './client.js'
import { createContent } from './content.js'
import { configSpecifier, generateContentTypes } from './generate-types.js'
import { pullContent } from './pull.js'
import type { PreviewResult, RichTextValue, Snapshot } from './types.js'

// Generated shape: camel keys, raw `key` kept for the CMS. Mirrors areca.gen.ts.
const schema = {
  articles: {
    key: 'articles',
    route: '/journal/$slug',
    routes: { nl: '/journaal/$slug' },
    fields: {
      slug: { key: 'slug', type: 'slug', required: true },
      title: { key: 'title', type: 'text', required: true, translatable: true },
      body: { key: 'body', type: 'richtext', required: false, translatable: true },
    },
  },
} as const

const globalSchema = {
  homePage: {
    key: 'home-page',
    seo: false,
    fields: {
      body: { key: 'body', type: 'richtext', required: false, translatable: true },
    },
  },
} as const

const LANGUAGES = { main: 'en', all: ['en', 'nl'] }

const directories: string[] = []
const previousFetch = globalThis.fetch
const previousCwd = process.cwd()
let served: { snapshot?: unknown } = {}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  globalThis.fetch = previousFetch
  process.chdir(previousCwd)
  served = {}
})

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'areca-preview-links-'))
  directories.push(value)
  return value
}

function fakeCms() {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/sites/snapshot/current') return Response.json(served.snapshot)
    return new Response('not found', { status: 404 })
  }
}

/** A published site with languages, so the manifest carries them. */
async function setup(options: { localizePath?: (path: string, locale: string) => string } = {}) {
  const outDir = directory()
  const snapshot = {
    publicationId: 'pub-1',
    siteKey: 'site',
    createdAt: '2026-03-01T00:00:00.000Z',
    hash: 'h1',
    languages: LANGUAGES,
    schema: {
      articles: {
        route: '/journal/$slug',
        routes: { nl: '/journaal/$slug' },
        fields: [
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
          { key: 'body', label: 'Body', type: 'richtext', translatable: true },
        ],
      },
    },
    collections: { articles: [] },
    globals: {},
  } as unknown as Snapshot
  fakeCms()
  served.snapshot = snapshot
  await pullContent({
    outDir,
    client: createArecaClient({ cmsUrl: 'https://cms.test', siteToken: 'site-token' }),
    ...(options.localizePath ? { localizePath: options.localizePath } : {}),
  })
  return createContent({ schema, globalSchema, dir: outDir, ...options })
}

/** A rich text value the way the CMS writes a link to an entry. */
function richText(href: string, entryId: string, locale?: string): RichTextValue {
  const attrs = { href, entryId, collection: 'articles', ...(locale ? { locale } : {}) }
  return {
    json: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Lees', marks: [{ type: 'link', attrs }] }] },
      ],
    },
    markdown: `[Lees][areca-entry-1]\n\n[areca-entry-1]: ${href}`,
    html: `<p><a href="${href}" data-areca-entry="${entryId}"${locale ? ` data-areca-locale="${locale}"` : ''}>Lees</a></p>`,
    entryLinks: [{ label: 'areca-entry-1', ...(locale ? { locale } : {}) }],
    document: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              href,
              entryId,
              ...(locale ? { locale } : {}),
              children: [{ type: 'text', value: 'Lees' }],
            },
          ],
        },
      ],
    },
  } as unknown as RichTextValue
}

/** A Dutch draft whose body holds one link. */
function dutchDraft(body: RichTextValue): PreviewResult {
  const data = { slug: 'voorbeeld', title: 'Voorbeeld', body }
  return {
    kind: 'entry',
    collection: 'articles',
    slug: 'voorbeeld',
    entry: {
      id: 'a1',
      slug: 'voorbeeld',
      publishedAt: null,
      locale: 'nl',
      data,
      locales: { nl: { slug: 'voorbeeld', data } },
    },
  } as unknown as PreviewResult
}

/** The rich text value of the `body` field of a preview's data. */
function bodyOf(data: unknown): RichTextValue {
  return (data as { body: RichTextValue }).body
}

function linkHrefs(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(/"href":"([^"]*)"/g)].map((match) => match[1]!)
}

describe('previewFrom: entry links are localized as pull localizes them', () => {
  it('gives a Dutch draft the Dutch path of a link to a translated target', async () => {
    const content = await setup()
    const preview = content.previewFrom(dutchDraft(richText('/journaal/example', 'target-nl')))
    expect(linkHrefs(bodyOf(preview.entry.data).json)).toEqual(['/nl/journaal/example'])
    expect(bodyOf(preview.entry.data).html).toContain('href="/nl/journaal/example"')
    expect(linkHrefs(bodyOf(preview.entry.data).document)).toEqual(['/nl/journaal/example'])
  })

  it('keeps the main-language path of a link to an English-only target', async () => {
    const content = await setup()
    const preview = content.previewFrom(
      dutchDraft(richText('/journal/example', 'target-en', 'en')),
    )
    expect(linkHrefs(bodyOf(preview.entry.data).json)).toEqual(['/journal/example'])
    expect(bodyOf(preview.entry.data).html).toContain('href="/journal/example"')
  })

  it('uses the config localizePath when the site sets one', async () => {
    const content = await setup({
      localizePath: (path, locale) => (locale === 'en' ? path : `/${locale}-be${path}`),
    })
    const preview = content.previewFrom(dutchDraft(richText('/journaal/example', 'target-nl')))
    expect(linkHrefs(bodyOf(preview.entry.data).json)).toEqual(['/nl-be/journaal/example'])
  })

  it('localizes the links of a site content preview too', async () => {
    const content = await setup()
    const result = {
      kind: 'global',
      global: 'home-page',
      entry: {
        id: 'g1',
        locale: 'nl',
        data: { body: richText('/journaal/example', 'target-nl') },
      },
    } as unknown as PreviewResult
    const preview = await content.previewGlobals(result)
    expect(preview.complete).toBe(true)
    expect(linkHrefs(bodyOf(preview.globals.homePage).json)).toEqual(['/nl/journaal/example'])
  })
})

describe('configSpecifier and the generated content module', () => {
  it('imports the config relative to the generated file, without its extension', () => {
    expect(configSpecifier('/app/src/generated/content/areca.gen.ts', '/app/areca.config.ts')).toBe(
      '../../../areca.config',
    )
    expect(configSpecifier('/app/areca.gen.ts', '/app/areca.config.ts')).toBe('./areca.config')
  })

  it('passes the config localizePath to createContent only when the config import is given', () => {
    const withConfig = generateContentTypes({
      schema: {},
      dir: './content',
      localizeConfigImport: '../../../areca.config',
    })
    expect(withConfig).toContain("import siteConfig from '../../../areca.config'")
    expect(withConfig).toContain('localizePath: siteConfig.i18n?.localizePath,')

    const without = generateContentTypes({ schema: {}, dir: './content' })
    expect(without).not.toContain('siteConfig')
  })
})
