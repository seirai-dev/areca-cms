import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

export function writeFixtureContent(outDir = CONTENT_DIR): Article[] {
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
          url: 'https://picsum.photos/seed/acme-welcome/1600/900',
          width: 1600,
          height: 900,
          alt: 'Sunrise over the Acme campus',
          mimeType: 'image/jpeg',
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
          url: 'https://picsum.photos/seed/acme-berlin/1600/900',
          width: 1600,
          height: 900,
          alt: 'Street view near the Berlin studio',
          mimeType: 'image/jpeg',
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
