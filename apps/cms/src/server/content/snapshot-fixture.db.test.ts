import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry, site } from '#/db/schema'
import type { EntryData, SiteLanguages } from '#/lib/types'

import { buildSnapshot } from './snapshot.ts'
import {
  articleFields,
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * A fixed site whose snapshot must stay byte for byte the same: the published
 * hash is what SDK sites compare, so any change to how the builder reads or
 * orders content shows up here. Ids, names and dates are fixed for that reason.
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

async function seedFixture(prefix: string, languages: SiteLanguages | null) {
  const ctx = await createTestSite({ languages })
  await db
    .update(site)
    .set({ name: 'Fixture Site', productionUrl: 'https://fixture.example' })
    .where(eq(site.id, ctx.site.id))
  const fields = [
    ...articleFields(),
    { key: 'related', label: 'Related', type: 'reference' as const },
  ]
  const articles = await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
    fields,
    localizedRoutes: languages ? { nl: '/nieuws/$slug' } : null,
  })
  const pages = await createTestCollection(ctx.site.id, {
    key: 'pages',
    routePattern: '/$slug',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      {
        key: 'feature',
        label: 'Feature',
        type: 'reference',
        collection: 'articles',
      },
    ],
  })
  const disabled = await createTestCollection(ctx.site.id, {
    key: 'archive',
    routePattern: '/archive/$slug',
  })
  await db
    .update(collection)
    .set({ enabled: false })
    .where(eq(collection.id, disabled.id))
  const [company, notes] = await db
    .insert(collection)
    .values([
      {
        siteId: ctx.site.id,
        key: 'company',
        label: 'Company',
        routePattern: '',
        kind: 'global' as const,
        fields: [
          { key: 'name', label: 'Name', type: 'text' as const, required: true },
          { key: 'about', label: 'About', type: 'richtext' as const },
        ],
        enabled: true,
        seoEnabled: true,
        previewPath: '/about',
      },
      {
        siteId: ctx.site.id,
        key: 'notes',
        label: 'Notes',
        routePattern: '',
        kind: 'global' as const,
        fields: [{ key: 'text', label: 'Text', type: 'text' as const }],
        enabled: true,
      },
    ])
    .returning()

  const id = (name: string) => `${prefix}-${name}`
  const at = (day: number) => new Date(Date.UTC(2026, 0, day, 9, 30))
  const translated = (data: EntryData, nl: EntryData): EntryData =>
    languages ? { ...data, $i18n: { nl } } : data
  const article = (title: string, slug: string, extra: EntryData = {}) => ({
    title,
    slug,
    excerpt: `${title} excerpt`,
    category: 'news',
    body: doc(paragraph(`${title} body`)),
    ...extra,
  })

  await db
    .delete(entry)
    .where(
      inArray(
        entry.id,
        ['a', 'b', 'c', 'd', 'e', 'f', 'p', 'g', 'n', 'x'].map(id),
      ),
    )
  await db.insert(entry).values([
    {
      id: id('a'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'alpha',
      status: 'published',
      publishedSlug: 'alpha',
      publishedAt: at(2),
      publishedData: translated(
        article('Alpha', 'alpha', {
          body: doc(heading('Intro', 'intro'), paragraph('Alpha body')),
        }),
        { title: 'Alfa', $slug: 'alfa' },
      ),
    },
    {
      id: id('b'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'beta',
      status: 'published',
      publishedSlug: 'beta',
      publishedAt: at(3),
      publishedData: article('Beta', 'beta', {
        related: id('a'),
        body: doc(
          paragraph('To alpha', {
            entryId: id('a'),
            collection: 'articles',
            anchor: 'intro',
          }),
          paragraph('To a draft', {
            entryId: id('c'),
            collection: 'articles',
          }),
          paragraph('To nothing', {
            entryId: id('missing'),
            collection: 'articles',
          }),
        ),
      }),
    },
    {
      id: id('c'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'gamma',
      status: 'draft',
      draftData: article('Gamma draft', 'gamma'),
    },
    {
      id: id('d'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'delta',
      status: 'scheduled',
      scheduledAt: at(4),
      scheduledSlug: 'delta',
      scheduledVersion: 'v-delta',
      scheduledData: article('Delta', 'delta'),
    },
    {
      id: id('e'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'epsilon',
      status: 'scheduled',
      scheduledAt: new Date(Date.UTC(2999, 0, 1)),
      scheduledSlug: 'epsilon-next',
      scheduledVersion: 'v-epsilon',
      scheduledData: article('Epsilon next', 'epsilon-next'),
      publishedSlug: 'epsilon',
      publishedAt: at(3),
      publishedData: article('Epsilon', 'epsilon'),
    },
    {
      id: id('f'),
      siteId: ctx.site.id,
      collectionId: articles.id,
      slug: 'future',
      status: 'scheduled',
      scheduledAt: new Date(Date.UTC(2999, 0, 1)),
      scheduledSlug: 'future',
      scheduledVersion: 'v-future',
      scheduledData: article('Future', 'future'),
    },
    {
      id: id('p'),
      siteId: ctx.site.id,
      collectionId: pages.id,
      slug: 'home',
      status: 'published',
      publishedSlug: 'home',
      publishedAt: at(1),
      publishedData: { title: 'Home', slug: 'home', feature: id('b') },
    },
    {
      id: id('x'),
      siteId: ctx.site.id,
      collectionId: disabled.id,
      slug: 'old',
      status: 'published',
      publishedSlug: 'old',
      publishedAt: at(1),
      publishedData: article('Old', 'old'),
    },
    {
      id: id('g'),
      siteId: ctx.site.id,
      collectionId: company.id,
      slug: '$global',
      status: 'published',
      publishedAt: at(5),
      publishedData: translated(
        {
          name: 'Fixture BV',
          about: doc(
            paragraph('See', { entryId: id('a'), collection: 'articles' }),
          ),
        },
        { name: 'Fixture NL' },
      ),
    },
    {
      id: id('n'),
      siteId: ctx.site.id,
      collectionId: notes.id,
      slug: '$global',
      status: 'draft',
    },
  ])
  return ctx
}

async function fixtureOutput(prefix: string, languages: SiteLanguages | null) {
  const ctx = await seedFixture(prefix, languages)
  try {
    const built = await buildSnapshot(ctx.site.id)
    if (!built.ok) throw new Error(built.errors.join('\n'))
    const {
      createdAt: _createdAt,
      siteKey: _siteKey,
      ...snapshot
    } = built.snapshot
    return JSON.stringify(
      {
        hash: built.hash,
        snapshot,
        entryVersions: built.entryVersions,
        linkWarnings: built.linkWarnings,
      },
      null,
      2,
    )
  } finally {
    await cleanupTestSite(ctx)
  }
}

describe.skipIf(!hasDb)('snapshot fixture', () => {
  it('builds the single-language fixture byte for byte as before', async () => {
    await expect(
      await fixtureOutput('snapfx-single', null),
    ).toMatchFileSnapshot('./__fixtures__/snapshot-single.json')
  })

  it('builds the multi-language fixture byte for byte as before', async () => {
    await expect(
      await fixtureOutput('snapfx-multi', { main: 'en', all: ['en', 'nl'] }),
    ).toMatchFileSnapshot('./__fixtures__/snapshot-multi.json')
  })
})
