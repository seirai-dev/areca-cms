import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ArecaClient } from './client.js'
import {
  defaultLocalizePath,
  localizeCollectionEntryLinks,
  localizeEntryLinks,
} from './entry-links.js'
import { pullContent, readContent } from './pull.js'
import type { RichTextValue, Snapshot, SiteLanguages } from './types.js'

const languages: SiteLanguages = { main: 'en', all: ['en', 'nl'] }

/** A rich text value shaped like the CMS publishes it, with one entry link and one plain link. */
function richText(
  href: string,
  entryId: string,
  anchor: string | null = null,
): RichTextValue {
  return {
    json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Lees meer',
              marks: [
                {
                  type: 'link',
                  attrs: { href, entryId, collection: 'events', anchor },
                },
              ],
            },
            { type: 'text', text: ' en ' },
            {
              type: 'text',
              text: 'over',
              marks: [{ type: 'link', attrs: { href: '/about' } }],
            },
          ],
        },
      ],
    },
    markdown: `[Lees meer][areca-entry-1] en [over](/about)\n\n[areca-entry-1]: ${href}`,
    html: `<p><a href="${href}" data-areca-entry="${entryId}">Lees meer</a> en <a href="/about">over</a></p>`,
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
              children: [{ type: 'text', value: 'Lees meer' }],
            },
            { type: 'text', value: ' en ' },
            {
              type: 'link',
              href: '/about',
              children: [{ type: 'text', value: 'over' }],
            },
          ],
        },
      ],
    },
  } as RichTextValue
}

function entryWith(body: RichTextValue) {
  return {
    id: 'event-1',
    slug: 'open-dag',
    publishedAt: null,
    locale: 'en',
    data: { title: 'Open day', body },
    locales: {
      en: { slug: 'open-day', data: { title: 'Open day', body } },
      nl: { slug: 'open-dag', data: { title: 'Open dag', body } },
    },
  }
}

describe('defaultLocalizePath', () => {
  it('keeps main-language paths and prefixes other languages', () => {
    const localize = defaultLocalizePath('en')
    expect(localize('/journaal/x', 'en')).toBe('/journaal/x')
    expect(localize('/journaal/x', 'nl')).toBe('/nl/journaal/x')
    expect(localize('/', 'nl')).toBe('/nl')
  })
})

describe('localizeEntryLinks', () => {
  const href = '/journaal/open-dag#programma'

  it('localizes the entry link in every format of a language, and only that link', () => {
    const body = richText(href, 'event-1', 'programma')
    const localized = localizeEntryLinks(
      entryWith(body),
      languages,
      defaultLocalizePath('en'),
    )
    const nl = localized.locales!.nl!.data.body as RichTextValue
    const en = localized.locales!.en!.data.body as RichTextValue

    // Dutch: the Dutch route and slug (the CMS wrote them), with the language prefix.
    expect(JSON.stringify(nl.json)).toContain(
      '"href":"/nl/journaal/open-dag#programma"',
    )
    const document = nl.document as { children: { children: unknown[] }[] }
    expect(document.children[0]!.children[0]).toMatchObject({
      href: '/nl/journaal/open-dag#programma',
      entryId: 'event-1',
    })
    expect(nl.html).toContain(
      '<a href="/nl/journaal/open-dag#programma" data-areca-entry="event-1">',
    )
    expect(nl.markdown).toContain(
      '[areca-entry-1]: /nl/journaal/open-dag#programma',
    )

    // The plain links are never touched.
    expect(nl.html).toContain('<a href="/about">over</a>')
    expect(nl.markdown).toContain('[over](/about)')
    expect(JSON.stringify(nl.json)).toContain('"href":"/about"')

    // The main language keeps its paths.
    expect(en.html).toContain(
      '<a href="/journaal/open-dag#programma" data-areca-entry="event-1">',
    )
    expect(en.markdown).toContain(
      '[areca-entry-1]: /journaal/open-dag#programma',
    )
  })

  it('applies a configured localizePath to every language, with the section kept', () => {
    const calls: [string, string][] = []
    const localize = (path: string, locale: string) => {
      calls.push([path, locale])
      return locale === 'nl' ? path.replace('/journaal/', '/dutch/') : path
    }
    const body = richText(
      '/journaal/open-dag#programma',
      'event-1',
      'programma',
    )
    const localized = localizeEntryLinks(entryWith(body), languages, localize)
    const nl = localized.locales!.nl!.data.body as RichTextValue
    expect(nl.html).toContain(
      '<a href="/dutch/open-dag#programma" data-areca-entry="event-1">',
    )
    // The function gets the path without the section.
    expect(calls).toContainEqual(['/journaal/open-dag', 'nl'])
    expect(calls.every(([path]) => !path.includes('#'))).toBe(true)
  })

  it('leaves snapshots without entry links exactly as they were', () => {
    const body = richText('/about', 'unused')
    // A plain-link-only value: no markers at all.
    const plain = {
      ...body,
      json: { type: 'doc', content: [] },
      markdown: '[over](/about)',
      html: '<p><a href="/about">over</a></p>',
      document: { type: 'root', children: [] },
    } as RichTextValue
    const entry = entryWith(plain)
    const localized = localizeEntryLinks(
      entry,
      languages,
      defaultLocalizePath('en'),
    )
    expect(localized).toEqual(entry)
  })

  it('localizes collections as a whole', () => {
    const snapshotCollections = {
      events: [entryWith(richText('/journaal/open-dag', 'event-1'))],
    } as unknown as Snapshot['collections']
    const out = localizeCollectionEntryLinks(
      snapshotCollections,
      languages,
      defaultLocalizePath('en'),
    )
    const nl = (out.events![0]!.locales!.nl!.data.body as RichTextValue).html
    expect(nl).toContain('href="/nl/journaal/open-dag"')
  })
})

const directories: string[] = []
afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

it('pulls a Dutch link to an entry as /nl/<nl route>/<nl slug>, with or without media', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'areca-entry-links-'))
  directories.push(outDir)
  const snapshot: Snapshot = {
    publicationId: 'links',
    hash: 'links',
    createdAt: '',
    siteKey: 'site',
    languages,
    schema: {
      events: {
        route: '/events/$slug',
        routes: { nl: '/journaal/$slug' },
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'body', label: 'Body', type: 'richtext' },
        ],
      },
    },
    collections: {
      events: [
        entryWith(
          richText('/journaal/open-dag#programma', 'event-1', 'programma'),
        ),
      ] as unknown as Snapshot['collections'][string],
    },
  } as unknown as Snapshot
  const client = {
    fetchSnapshot: vi.fn().mockResolvedValue(snapshot),
  } as unknown as ArecaClient

  await pullContent({ outDir, client })
  const [event] = readContent(outDir, 'events') as unknown as {
    locales: Record<string, { data: { body: RichTextValue } }>
  }[]
  const nl = event!.locales.nl!.data.body
  expect(nl.html).toContain('href="/nl/journaal/open-dag#programma"')
  expect(nl.markdown).toContain(
    '[areca-entry-1]: /nl/journaal/open-dag#programma',
  )
})
