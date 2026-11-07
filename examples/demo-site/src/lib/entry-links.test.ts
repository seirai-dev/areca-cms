import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ArecaClient, RichTextValue, Snapshot } from '@areca-cms/site-sdk'
import { pullContent, readContent } from '@areca-cms/site-sdk/pull'

import config from '../../areca.config.ts'
import { localizedPath } from './locale-routes.ts'

/**
 * A Dutch link to a journal article, in the demo's own config. The CMS writes
 * the link with the Dutch route and slug (`/journaal/<nl slug>`, no locale
 * prefix); the SDK adds `/nl` at pull time, so the page is `/nl/journaal/...`.
 */
const directories: string[] = []
afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

/** The value the CMS writes for a link to a Dutch-translated entry: every marker names `nl`. */
function richTextWithLink(href: string, entryId: string): RichTextValue {
  return {
    json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Lees het artikel',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href,
                    entryId,
                    collection: 'articles',
                    anchor: null,
                    locale: 'nl',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    markdown: `[Lees het artikel][areca-entry-1]\n\n[areca-entry-1]: ${href}`,
    html: `<p><a href="${href}" data-areca-entry="${entryId}" data-areca-locale="nl">Lees het artikel</a></p>`,
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
              locale: 'nl',
              children: [{ type: 'text', value: 'Lees het artikel' }],
            },
          ],
        },
      ],
    },
    entryLinks: [{ label: 'areca-entry-1', locale: 'nl' }],
  } as unknown as RichTextValue
}

describe('entry links in the demo site', () => {
  it('pulls a Dutch link to a journal article as /nl/journaal/<nl slug>', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'demo-entry-links-'))
    directories.push(outDir)
    const body = richTextWithLink('/journaal/open-dag', 'article-1')
    const snapshot = {
      publicationId: 'links',
      hash: 'links',
      createdAt: '',
      siteKey: config.siteKey,
      languages: config.languages,
      schema: {
        articles: {
          route: config.collections.articles.route,
          routes: config.collections.articles.routes,
          fields: [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'body', label: 'Body', type: 'richtext' },
          ],
        },
      },
      collections: {
        articles: [
          {
            id: 'article-1',
            slug: 'open-day',
            publishedAt: null,
            locale: 'en',
            data: { title: 'Open day', body },
            locales: {
              en: { slug: 'open-day', data: { title: 'Open day', body } },
              nl: {
                slug: 'open-dag',
                data: {
                  title: 'Open dag',
                  body: richTextWithLink('/journaal/open-dag', 'article-1'),
                },
              },
            },
          },
        ],
      },
    } as unknown as Snapshot
    const client = {
      fetchSnapshot: vi.fn().mockResolvedValue(snapshot),
    } as unknown as ArecaClient

    await pullContent({ outDir, client })
    const [article] = readContent(outDir, 'articles') as unknown as {
      locales: Record<string, { data: { body: RichTextValue } }>
    }[]

    // The demo's Dutch route, with the Dutch slug, under /nl.
    const dutchRoute = config.collections.articles.routes.nl
    expect(dutchRoute).toBe('/journaal/$slug')
    const expected = `/nl${dutchRoute.replace('$slug', 'open-dag')}`
    expect(expected).toBe('/nl/journaal/open-dag')
    // The site's own URL rules agree with the SDK's default.
    expect(localizedPath('/journal/open-dag', 'nl')).toBe(expected)

    const nl = article!.locales.nl!.data.body
    expect(nl.html).toContain(`href="${expected}"`)
    expect(nl.markdown).toContain(`[areca-entry-1]: ${expected}`)
  })
})
