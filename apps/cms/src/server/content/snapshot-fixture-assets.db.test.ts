import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { asset, collection, entry, site } from '#/db/schema'
import type * as Env from '#/env'
import type { EntryData, SiteLanguages } from '#/lib/types'

import { buildSnapshot } from './snapshot.ts'
import {
  buildPreviewEntry,
  buildPreviewEntryFromDraft,
  buildPreviewGlobal,
} from './snapshot-preview.ts'
import { getCollection } from './collections.ts'
import { findSite } from './site-core.ts'
import {
  articleFields,
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

vi.mock('#/env', async (importOriginal) => {
  const actual = await importOriginal<typeof Env>()
  return { env: { ...actual.env, APP_URL: 'https://cms.fixture' } }
})

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * Fixed sites whose snapshot and previews must stay byte for byte the same,
 * next to snapshot-fixture.db.test.ts: assets (image fields, rich text images,
 * og:image and its hero fallback), SEO and JSON-LD, link warnings from a
 * section, and the draft previews of the same content.
 */

function doc(...content: unknown[]) {
  return { type: 'doc', content }
}
function heading(text: string, id: string) {
  return {
    type: 'heading',
    attrs: { level: 2, id },
    content: [{ type: 'text', text }],
  }
}
function paragraph(text: string, link?: Record<string, unknown>) {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text,
        ...(link
          ? { marks: [{ type: 'link', attrs: { href: '/x', ...link } }] }
          : {}),
      },
    ],
  }
}
function image(src: string) {
  return { type: 'image', attrs: { src } }
}

async function seedFixture(prefix: string, languages: SiteLanguages | null) {
  const ctx = await createTestSite({ languages })
  await db
    .update(site)
    .set({ name: 'Fixture Site', productionUrl: 'https://fixture.example' })
    .where(eq(site.id, ctx.site.id))
  const id = (name: string) => `${prefix}-${name}`
  const key = (name: string) => `snapfx/${prefix}/${name}.png`
  const at = (day: number) => new Date(Date.UTC(2026, 0, day, 9, 30))
  const translated = (data: EntryData, nl: EntryData): EntryData =>
    languages ? { ...data, $i18n: { nl } } : data

  await db
    .delete(asset)
    .where(inArray(asset.id, ['hero', 'inline', 'og', 'logo'].map(id)))
  const emptyAlt: Record<string, string> = {}
  await db.insert(asset).values(
    ['hero', 'inline', 'og', 'logo'].map((name, i) => ({
      id: id(name),
      organizationId: ctx.org.id,
      storageKey: key(name),
      originalFilename: `${name}.png`,
      mimeType: 'image/png',
      size: 100 + i,
      width: 640 + i,
      height: 480 + i,
      altText: `${name} alt`,
      altI18n: languages ? { nl: `${name} alt nl` } : emptyAlt,
    })),
  )

  const articles = await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
    fields: [
      ...articleFields(),
      {
        key: 'related',
        label: 'Related',
        type: 'reference',
        collection: 'articles',
      },
    ],
    localizedRoutes: languages ? { nl: '/nieuws/$slug' } : null,
  })
  const [company] = await db
    .insert(collection)
    .values({
      siteId: ctx.site.id,
      key: 'company',
      label: 'Company',
      routePattern: '',
      kind: 'global' as const,
      fields: [
        { key: 'name', label: 'Name', type: 'text' as const, required: true },
        { key: 'logo', label: 'Logo', type: 'image' as const },
        { key: 'about', label: 'About', type: 'richtext' as const },
      ],
      enabled: true,
      seoEnabled: true,
      previewPath: '/about',
    })
    .returning()

  const one: EntryData = translated(
    {
      title: 'One',
      slug: 'one',
      excerpt: 'One excerpt',
      category: 'news',
      heroImage: id('hero'),
      publishedAt: '2025-12-24T08:00:00.000Z',
      body: doc(
        heading('Start', 'start'),
        paragraph('One body'),
        image(`/api/assets/file/${key('inline')}`),
      ),
      $seo: {
        title: 'One SEO title',
        description: 'One SEO description',
        ogImage: id('og'),
        schemaType: 'BlogPosting',
        summary: 'One summary',
        keyTakeaways: ['First', 'Second'],
        faq: [{ question: 'Why?', answer: 'Because.' }],
        author: { name: 'Ada', url: 'https://ada.example' },
        about: [{ name: 'Testing', sameAs: 'https://testing.example' }],
        jsonLd: '{"@type":"Thing","name":"Extra"}',
      },
    },
    {
      title: 'Een',
      $slug: 'een',
      body: doc(heading('Begin', 'begin'), paragraph('Een tekst')),
    },
  )
  const two: EntryData = {
    title: 'Two',
    slug: 'two',
    category: 'updates',
    heroImage: id('hero'),
    related: id('one'),
    body: doc(
      paragraph('To one start', {
        entryId: id('one'),
        collection: 'articles',
        anchor: 'start',
      }),
      paragraph('To one gone', {
        entryId: id('one'),
        collection: 'articles',
        anchor: 'gone',
      }),
      paragraph('To draft', { entryId: id('draft'), collection: 'articles' }),
    ),
  }
  const companyData: EntryData = translated(
    {
      name: 'Fixture BV',
      logo: id('logo'),
      about: doc(
        paragraph('See draft', {
          entryId: id('draft'),
          collection: 'articles',
        }),
        image(`/api/assets/file/${key('inline')}`),
      ),
      $seo: { description: 'About us', ogImage: id('og') },
    },
    { name: 'Fixture NL' },
  )

  await db
    .delete(entry)
    .where(inArray(entry.id, ['one', 'two', 'draft', 'company'].map(id)))
  await db.insert(entry).values([
    {
      id: id('one'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'one',
      status: 'published',
      publishedSlug: 'one',
      publishedAt: at(2),
      publishedData: one,
      draftData: one,
    },
    {
      id: id('two'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'two',
      status: 'published',
      publishedSlug: 'two',
      publishedAt: at(3),
      publishedData: two,
      draftData: two,
    },
    {
      id: id('draft'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'draft',
      status: 'draft',
      draftData: translated(
        { title: 'Draft', slug: 'draft', body: doc(paragraph('Draft')) },
        { title: 'Concept', $slug: 'concept' },
      ),
    },
    {
      id: id('company'),
      siteId: ctx.site.id,
      collectionId: company.id,
      slug: '$global',
      status: 'published',
      publishedAt: at(5),
      publishedData: companyData,
      draftData: companyData,
    },
  ])
  return { ctx, id, key }
}

async function fixtureOutput(prefix: string, languages: SiteLanguages | null) {
  const { ctx, id, key } = await seedFixture(prefix, languages)
  try {
    const built = await buildSnapshot(ctx.site.id)
    if (!built.ok) throw new Error(built.errors.join('\n'))
    const {
      createdAt: _createdAt,
      siteKey: _siteKey,
      ...snapshot
    } = built.snapshot

    const requests = languages ? [null, 'nl', 'de'] : [null]
    const previews: Record<string, unknown> = {}
    for (const locale of requests) {
      const tag = locale ?? 'default'
      previews[`one:${tag}`] = await buildPreviewEntry(
        ctx.site.id,
        'articles',
        'one',
        locale,
      )
      previews[`two:${tag}`] = await buildPreviewEntry(
        ctx.site.id,
        'articles',
        'two',
        locale,
      )
      previews[`company:${tag}`] = await buildPreviewGlobal(
        ctx.site.id,
        'company',
        locale,
      )
    }
    // An unsaved draft: a missing asset and a missing reference become null,
    // and links go to drafts.
    const col = await getCollection(ctx.site.id, 'articles')
    const previewSite = await findSite(ctx.site.id)
    previews.unsaved = await buildPreviewEntryFromDraft({
      site: previewSite!,
      collection: col!,
      entryRow: { id: id('new'), slug: 'new', publishedAt: null },
      draftData: {
        title: 'New',
        slug: 'new',
        heroImage: id('nope'),
        related: id('nope'),
        body: doc(
          paragraph('To draft', {
            entryId: id('draft'),
            collection: 'articles',
          }),
          paragraph('To two', { entryId: id('two'), collection: 'articles' }),
          image(`/api/assets/file/${key('hero')}`),
        ),
        $seo: { ogImage: id('nope') },
      },
      locale: languages ? 'nl' : null,
    })

    return JSON.stringify(
      {
        hash: built.hash,
        snapshot,
        entryVersions: built.entryVersions,
        linkWarnings: built.linkWarnings,
        previews,
      },
      null,
      2,
    )
  } finally {
    await cleanupTestSite(ctx)
  }
}

describe.skipIf(!hasDb)('snapshot fixture with assets and SEO', () => {
  it('builds the single-language fixture byte for byte as before', async () => {
    await expect(
      await fixtureOutput('snapfxa-single', null),
    ).toMatchFileSnapshot('./__fixtures__/snapshot-assets-single.json')
  })

  it('builds the multi-language fixture byte for byte as before', async () => {
    await expect(
      await fixtureOutput('snapfxa-multi', { main: 'en', all: ['en', 'nl'] }),
    ).toMatchFileSnapshot('./__fixtures__/snapshot-assets-multi.json')
  })
})
