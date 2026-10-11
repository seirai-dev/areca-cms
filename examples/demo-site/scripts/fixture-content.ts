import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { renderHtml } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { PulledContentManifest, RichTextValue } from '@areca-cms/site-sdk'
import { CONTENT_DIR, type Article } from '../src/lib/content.ts'

export const FIXTURE_SLUGS = [
  'welcome-to-acme',
  'q1-product-updates',
  'berlin-office-opening',
] as const

/** Mirrors the CMS: markdown is canonical, document and html derive from it. */
function richText(markdown: string): RichTextValue {
  const document = parseMarkdown(markdown, { frontmatter: false })
  return {
    json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: markdown.replace(/\n+/g, ' ') }],
        },
      ],
    },
    markdown,
    document,
    html: renderHtml(document),
  }
}

/** Where `areca pull` copies media for this site (see areca.config.ts). */
export const MEDIA_DIR = join(process.cwd(), 'public/areca')

/** A solid-colour PNG, so fixtures work offline like pulled media does. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3)
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function writeFixtureContent(outDir = CONTENT_DIR, mediaDir = MEDIA_DIR): Article[] {
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(join(mediaDir, 'acme-welcome-fixture1.png'), solidPng(1600, 900, [242, 166, 90]))
  writeFileSync(join(mediaDir, 'acme-berlin-fixture2.png'), solidPng(1600, 900, [90, 140, 200]))

  const articles: Article[] = [
    {
      id: 'ent_welcome',
      slug: FIXTURE_SLUGS[0],
      publishedAt: '2026-03-12T09:00:00.000Z',
      data: {
        title: 'Welcome to Acme',
        slug: FIXTURE_SLUGS[0],
        excerpt:
          'Acme is live. A short tour of how we publish articles from Areca and ship them as static pages.',
        body: richText(
          'Today we launched **Acme**, a customer site that reads an Areca snapshot at build time and prerenders every article.\n\nEditors write in the CMS. Visitors never call it.',
        ),
        heroImage: {
          url: '/areca/acme-welcome-fixture1.png',
          width: 1600,
          height: 900,
          alt: 'Sunrise over the Acme campus',
          mimeType: 'image/png',
        },
        publishedAt: '2026-03-12T09:00:00.000Z',
        category: 'news',
      },
    },
    {
      id: 'ent_updates',
      slug: FIXTURE_SLUGS[1],
      publishedAt: '2026-06-02T14:30:00.000Z',
      data: {
        title: 'Q1 product updates',
        slug: FIXTURE_SLUGS[1],
        excerpt:
          'Faster previews, clearer publication errors, and a health check the CMS can poll after deploy.',
        body: richText(
          '## What shipped\n\n- Draft preview URLs that stay noindex\n- A snapshot pull that fails loudly when nothing is published\n- Static HTML for every article slug\n\nUpgrade notes live with your deployment target.',
        ),
        heroImage: null,
        publishedAt: '2026-06-02T14:30:00.000Z',
        category: 'updates',
      },
    },
    {
      id: 'ent_berlin',
      slug: FIXTURE_SLUGS[2],
      publishedAt: '2026-08-18T08:15:00.000Z',
      data: {
        title: 'Acme opens a Berlin office',
        slug: FIXTURE_SLUGS[2],
        excerpt:
          'A small studio in Kreuzberg for customer workshops and the next publishing cycle.',
        body: richText(
          'We opened a Berlin studio this month. Come by for an editor walkthrough or a deploy review.\n\n> Same content model. Same build. New timezone.',
        ),
        heroImage: {
          url: '/areca/acme-berlin-fixture2.png',
          width: 1600,
          height: 900,
          alt: 'Street view near the Berlin studio',
          mimeType: 'image/png',
        },
        publishedAt: '2026-08-18T08:15:00.000Z',
        category: 'news',
      },
    },
  ]

  const manifest: PulledContentManifest = {
    publicationId: 'pub_fixture_acme',
    hash: 'fixture-acme-sha256',
    createdAt: '2026-08-18T08:15:00.000Z',
    collections: { articles: articles.length },
    assets: { publicPath: '/areca', count: 2 },
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(join(outDir, 'articles.json'), `${JSON.stringify(articles, null, 2)}\n`, 'utf8')
  return articles
}

const isCli = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/fixture-content.ts')
if (isCli) {
  const articles = writeFixtureContent()
  console.log(
    `Wrote fixture publication pub_fixture_acme (${articles.length} articles) to ${CONTENT_DIR}`,
  )
}
