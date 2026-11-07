import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'

import { archiveEntry, createEntry, publishEntry } from './entries.ts'
import {
  checkLinkTargets,
  linkTargetHeadings,
  resolveMarkdownLinkTargets,
  searchLinkTargets,
} from './link-targets.ts'
import {
  cleanupTestSite,
  createTestCollection,
  createTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const languages = { main: 'nl', all: ['nl', 'en'] }

/** A body with one heading per entry of `headings`, each followed by a paragraph. */
function doc(headings: string[]) {
  return {
    type: 'doc',
    content: headings.flatMap((text) => [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Tekst' }] },
    ]),
  }
}

async function setup(suffix: string) {
  const ctx = await createTestSite({ languages })
  await createTestCollection(ctx.site.id, {
    key: 'articles',
    routePattern: '/blog/$slug',
    localizedRoutes: { en: '/news/$slug' },
  })
  await createTestCollection(ctx.site.id, {
    key: 'pages',
    routePattern: '/info/$slug',
  })
  // Main language: Dutch title and slug. English: its own title, slug and sections.
  const coffee = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Koffie uit Ethiopië',
      slug: `koffie-ethiopie-${suffix}`,
      body: doc(['Herkomst']),
      $i18n: {
        en: {
          title: 'Coffee from Ethiopia',
          $slug: `coffee-ethiopia-${suffix}`,
          body: doc(['Origin']),
        },
      },
    },
    actorId: ctx.actor.id,
  })
  await publishEntry(coffee.id, ctx.actor.id)
  // A draft page without a translation.
  const about = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'pages',
    data: {
      title: 'Over ons',
      slug: `over-ons-${suffix}`,
      body: doc(['Wie we zijn']),
    },
    actorId: ctx.actor.id,
  })
  // An archived article: no link may point at it.
  const old = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Verlopen artikel',
      slug: `verlopen-${suffix}`,
      body: doc(['Oud']),
    },
    actorId: ctx.actor.id,
  })
  await archiveEntry(old.id, ctx.actor.id)
  return { ctx, coffee, about, old }
}

describe.skipIf(!hasDb)('link targets: search', () => {
  it('matches the title in the language being edited, with that language path', async () => {
    const { ctx, coffee } = await setup('title')
    try {
      const en = await searchLinkTargets(ctx.site.id, {
        query: 'ethiopia',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(en.entries.map((option) => option.entryId)).toEqual([coffee.id])
      expect(en.entries[0]).toMatchObject({
        title: 'Coffee from Ethiopia',
        path: '/news/coffee-ethiopia-title',
        collection: 'articles',
        collectionLabel: 'Articles',
        status: 'published',
        mainSlug: 'koffie-ethiopie-title',
      })

      // The Dutch title is not searched in English: the English translation has its own.
      const dutchInEnglish = await searchLinkTargets(ctx.site.id, {
        query: 'koffie',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(dutchInEnglish.entries).toEqual([])

      const nl = await searchLinkTargets(ctx.site.id, {
        query: 'koffie',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(nl.entries[0]).toMatchObject({
        title: 'Koffie uit Ethiopië',
        path: '/blog/koffie-ethiopie-title',
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('searches every routed collection, skips archived entries and lists the newest first when empty', async () => {
    const { ctx, coffee, about, old } = await setup('all')
    try {
      const found = await searchLinkTargets(ctx.site.id, {
        query: 'o',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      const ids = found.entries.map((option) => option.entryId)
      expect(ids).toContain(about.id)
      expect(ids).toContain(coffee.id)
      expect(ids).not.toContain(old.id)

      const recent = await searchLinkTargets(ctx.site.id, {
        query: '',
        locale: 'nl',
        limit: 2,
        enabledOnly: true,
      })
      expect(recent.entries).toHaveLength(2)
      expect(recent.entries.map((option) => option.entryId)).not.toContain(
        old.id,
      )
      expect(recent.resolved).toBeNull()
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('reports the status of drafts and published entries', async () => {
    const { ctx, coffee, about } = await setup('status')
    try {
      const byId = await searchLinkTargets(ctx.site.id, {
        query: '/info/over-ons-status',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(byId.resolved?.entry).toMatchObject({
        entryId: about.id,
        status: 'draft',
        publishedSlug: null,
      })
      const published = await searchLinkTargets(ctx.site.id, {
        query: '/blog/koffie-ethiopie-status',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(published.resolved?.entry).toMatchObject({
        entryId: coffee.id,
        status: 'published',
        publishedSlug: 'koffie-ethiopie-status',
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('hides collections switched off for non-admins', async () => {
    const { ctx, about } = await setup('off')
    try {
      await db
        .update(collection)
        .set({ enabled: false })
        .where(
          and(eq(collection.siteId, ctx.site.id), eq(collection.key, 'pages')),
        )
      const asEditor = await searchLinkTargets(ctx.site.id, {
        query: '/info/over-ons-off',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(asEditor.resolved).toBeNull()
      const asAdmin = await searchLinkTargets(ctx.site.id, {
        query: '/info/over-ons-off',
        locale: 'nl',
        limit: 8,
        enabledOnly: false,
      })
      expect(asAdmin.resolved?.entry.entryId).toBe(about.id)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('resolves typed paths in any language, with a section, and own-domain URLs', async () => {
    const { ctx, coffee, about } = await setup('path')
    try {
      const mainPath = await searchLinkTargets(ctx.site.id, {
        query: '/blog/koffie-ethiopie-path',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(mainPath.resolved).toEqual({
        entry: expect.objectContaining({
          entryId: coffee.id,
          path: '/blog/koffie-ethiopie-path',
        }),
        anchor: null,
      })

      // The main-language path resolves in English too, to the English path.
      const inEnglish = await searchLinkTargets(ctx.site.id, {
        query: '/blog/koffie-ethiopie-path',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(inEnglish.resolved?.entry.path).toBe('/news/coffee-ethiopia-path')

      const withSection = await searchLinkTargets(ctx.site.id, {
        query: '/news/coffee-ethiopia-path#origin',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(withSection.resolved).toEqual({
        entry: expect.objectContaining({ entryId: coffee.id }),
        anchor: 'origin',
      })

      const ownUrl = await searchLinkTargets(ctx.site.id, {
        query: 'http://localhost:3999/info/over-ons-path#wie',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(ownUrl.resolved).toEqual({
        entry: expect.objectContaining({ entryId: about.id }),
        anchor: 'wie',
      })
      expect(ownUrl.ownPath).toBe('/info/over-ons-path#wie')

      const otherHost = await searchLinkTargets(ctx.site.id, {
        query: 'https://example.org/info/over-ons-path',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(otherHost).toEqual({ entries: [], resolved: null, ownPath: null })

      const unknown = await searchLinkTargets(ctx.site.id, {
        query: '/info/bestaat-niet',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(unknown.resolved).toBeNull()
      expect(unknown.entries).toEqual([])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('finds an older title that matches ahead of newer entries that only mention the word in the body', async () => {
    const { ctx } = await setup('ranking')
    try {
      const [articles] = await db
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(
            eq(collection.siteId, ctx.site.id),
            eq(collection.key, 'articles'),
          ),
        )
      const now = Date.now()
      // 320 newer articles mention coffee in the body only.
      await db.insert(entry).values(
        Array.from({ length: 320 }, (_, index) => ({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: `bonen-${index}-ranking`,
          status: 'draft' as const,
          draftData: {
            title: `Bonen ${index}`,
            body: doc(['Coffee beans from the archive']),
          },
          updatedAt: new Date(now + index * 1000),
        })),
      )
      // One older article is titled "Coffee".
      await db.insert(entry).values({
        siteId: ctx.site.id,
        collectionId: articles.id,
        slug: `coffee-title-ranking`,
        status: 'draft',
        draftData: { title: 'Coffee', body: doc(['Oud']) },
        updatedAt: new Date(now - 86_400_000),
      })

      const found = await searchLinkTargets(ctx.site.id, {
        query: 'coffee',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(found.entries[0]).toMatchObject({
        title: 'Coffee',
        slug: 'coffee-title-ranking',
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('matches a typed path on the route first, then on the slug, whatever the body says', async () => {
    const { ctx, coffee, about } = await setup('pathroute')
    try {
      // Mentions the blog in its body only: it lives under /info, not /blog.
      await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'pages',
        data: {
          title: 'Contact',
          slug: 'contact-pathroute',
          body: doc(['Lees onze blog over koffie']),
        },
        actorId: ctx.actor.id,
      })
      for (const query of ['/blo', '/blog/', '/blog/koffie']) {
        const found = await searchLinkTargets(ctx.site.id, {
          query,
          locale: 'nl',
          limit: 8,
          enabledOnly: true,
        })
        expect(found.entries.map((hit) => hit.entryId)).toEqual([coffee.id])
      }
      const pages = await searchLinkTargets(ctx.site.id, {
        query: '/info/over',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(pages.entries.map((hit) => hit.entryId)).toEqual([about.id])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('matches a path in the route of a language, and its slug in that language', async () => {
    const ctx = await createTestSite({
      languages: { main: 'en', all: ['en', 'nl'] },
    })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
        localizedRoutes: { nl: '/journaal/$slug' },
      })
      const article = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Coffee from Ethiopia',
          slug: 'coffee-ethiopia-journal',
          body: doc(['Origin']),
          $i18n: {
            nl: {
              title: 'Koffie uit Ethiopië',
              $slug: 'koffie-ethiopie-journal',
              body: doc(['Herkomst']),
            },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(article.id, ctx.actor.id)

      for (const query of ['/journaal', '/journaal/koff']) {
        const found = await searchLinkTargets(ctx.site.id, {
          query,
          locale: 'en',
          limit: 8,
          enabledOnly: true,
        })
        expect(found.entries.map((hit) => hit.entryId)).toEqual([article.id])
      }
      const exact = await searchLinkTargets(ctx.site.id, {
        query: '/journaal/koffie-ethiopie-journal',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(exact.resolved?.entry.entryId).toBe(article.id)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('finds a path among the candidates even when newer entries in another language share its prefix', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
        localizedRoutes: { en: '/news/$slug' },
      })
      const [articles] = await db
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(
            eq(collection.siteId, ctx.site.id),
            eq(collection.key, 'articles'),
          ),
        )
      const now = Date.now()
      // 32 newer articles whose English slugs start with "coffee": under
      // /news/, never under /blog/cof.
      await db.insert(entry).values(
        Array.from({ length: 32 }, (_, index) => ({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: `bonen-${index}-candidates`,
          status: 'draft' as const,
          draftData: {
            title: `Bonen ${index}`,
            $i18n: {
              en: {
                title: `Coffee beans ${index}`,
                $slug: `coffee-beans-${index}-candidates`,
              },
            },
          },
          updatedAt: new Date(now + index * 1000),
        })),
      )
      // The older article is under /blog/coffee… in the main language.
      const older = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: 'coffee-beans-older-candidates',
          status: 'draft',
          draftData: { title: 'Koffiebonen', body: doc(['Oud']) },
          updatedAt: new Date(now - 86_400_000),
        })
        .returning({ id: entry.id })

      const found = await searchLinkTargets(ctx.site.id, {
        query: '/blog/cof',
        locale: 'nl',
        limit: 5,
        enabledOnly: true,
      })
      expect(found.entries.map((hit) => hit.entryId)).toEqual([older[0].id])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('skips newer translations that do not ship, so an older valid path is still found', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
        localizedRoutes: { en: '/news/$slug' },
      })
      const [articles] = await db
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(
            eq(collection.siteId, ctx.site.id),
            eq(collection.key, 'articles'),
          ),
        )
      const now = Date.now()
      // Nine newer articles whose English translation is incomplete (no body,
      // a required field): it does not ship, so none of them answers to
      // /news/cof. Their paths all match the SQL prefix, so they used to fill
      // the whole result limit.
      await db.insert(entry).values(
        Array.from({ length: 9 }, (_, index) => ({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: `incompleet-${index}`,
          status: 'draft' as const,
          draftData: {
            title: `Incompleet ${index}`,
            $i18n: {
              en: {
                title: `Incomplete ${index}`,
                $slug: `coffee-incomplete-${index}`,
              },
            },
          },
          updatedAt: new Date(now + index * 1000),
        })),
      )
      // An older article whose English translation is complete: it answers
      // to /news/coffee-older.
      const older = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: 'koffie-older',
          status: 'draft',
          draftData: {
            title: 'Koffie oud',
            body: doc(['Oud']),
            $i18n: {
              en: {
                title: 'Coffee older',
                $slug: 'coffee-older',
                body: doc(['Older']),
              },
            },
          },
          updatedAt: new Date(now - 86_400_000),
        })
        .returning({ id: entry.id })

      const found = await searchLinkTargets(ctx.site.id, {
        query: '/news/cof',
        locale: 'en',
        limit: 5,
        enabledOnly: true,
      })
      expect(found.entries.map((hit) => hit.entryId)).toEqual([older[0].id])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('reads past the first page of candidates to find an older valid path', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
        localizedRoutes: { en: '/news/$slug' },
      })
      const [articles] = await db
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(
            eq(collection.siteId, ctx.site.id),
            eq(collection.key, 'articles'),
          ),
        )
      const now = Date.now()
      // 60 newer incomplete translations: more than one candidate page.
      await db.insert(entry).values(
        Array.from({ length: 60 }, (_, index) => ({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: `onvolledig-${index}`,
          status: 'draft' as const,
          draftData: {
            title: `Onvolledig ${index}`,
            $i18n: {
              en: {
                title: `Incomplete ${index}`,
                $slug: `coffee-partial-${index}`,
              },
            },
          },
          updatedAt: new Date(now + index * 1000),
        })),
      )
      const older = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: 'koffie-second-page',
          status: 'draft',
          draftData: {
            title: 'Koffie tweede pagina',
            body: doc(['Oud']),
            $i18n: {
              en: {
                title: 'Coffee second page',
                $slug: 'coffee-second-page',
                body: doc(['Second']),
              },
            },
          },
          updatedAt: new Date(now - 86_400_000),
        })
        .returning({ id: entry.id })

      const found = await searchLinkTargets(ctx.site.id, {
        query: '/news/cof',
        locale: 'en',
        limit: 5,
        enabledOnly: true,
      })
      expect(found.entries.map((hit) => hit.entryId)).toEqual([older[0].id])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('shows and searches the same title after the main language changed', async () => {
    // The site was Dutch; English is the main language now. The entry still
    // has Dutch base values (`$locale: nl`) and an English translation.
    const ctx = await createTestSite({
      languages: { main: 'en', all: ['en', 'nl'] },
    })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      const [articles] = await db
        .select({ id: collection.id })
        .from(collection)
        .where(
          and(
            eq(collection.siteId, ctx.site.id),
            eq(collection.key, 'articles'),
          ),
        )
      const [row] = await db
        .insert(entry)
        .values({
          siteId: ctx.site.id,
          collectionId: articles.id,
          slug: 'koffie-langwissel',
          status: 'draft',
          draftData: {
            title: 'Koffie uit Ethiopië',
            body: doc(['Herkomst']),
            $locale: 'nl',
            $i18n: {
              en: {
                title: 'Coffee from Ethiopia',
                $slug: 'coffee-ethiopia-langwissel',
              },
            },
          },
        })
        .returning({ id: entry.id })

      const shown = await searchLinkTargets(ctx.site.id, {
        query: 'coffee',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(shown.entries).toEqual([
        expect.objectContaining({
          entryId: row.id,
          title: 'Coffee from Ethiopia',
          slug: 'coffee-ethiopia-langwissel',
        }),
      ])
      // Searching the title the row shows finds the same entry.
      const byShownTitle = await searchLinkTargets(ctx.site.id, {
        query: 'Coffee from Ethiopia',
        locale: 'en',
        limit: 8,
        enabledOnly: true,
      })
      expect(byShownTitle.entries.map((hit) => hit.entryId)).toEqual([row.id])
      // The Dutch base values are what Dutch shows.
      const dutch = await searchLinkTargets(ctx.site.id, {
        query: 'koffie',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(dutch.entries[0]).toMatchObject({
        title: 'Koffie uit Ethiopië',
        slug: 'koffie-langwissel',
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('makes the same number of queries whatever the number of routed collections', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: { title: 'Koffie count', slug: 'koffie-count', body: doc([]) },
        actorId: ctx.actor.id,
      })
      const countQueries = async (query: string) => {
        const spy = vi.spyOn(db, 'select')
        try {
          await searchLinkTargets(ctx.site.id, {
            query,
            locale: 'nl',
            limit: 8,
            enabledOnly: true,
          })
          return spy.mock.calls.length
        } finally {
          spy.mockRestore()
        }
      }
      const words = await countQueries('koffie')
      const path = await countQueries('/blog/koffie')
      for (let index = 0; index < 5; index++) {
        await createTestCollection(ctx.site.id, {
          key: `extra${index}`,
          routePattern: `/extra${index}/$slug`,
        })
      }
      expect(await countQueries('koffie')).toBe(words)
      expect(await countQueries('/blog/koffie')).toBe(path)
      // The site, then one query for the entries of all collections.
      expect(words).toBe(2)
      expect(path).toBe(2)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('matches % and _ in a search literally', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      for (const [title, slug] of [
        ['50% Arabica', 'arabica-procent-wild'],
        ['50 Arabica', 'arabica-spatie-wild'],
        ['bean_one', 'bean-een-wild'],
        ['beanXone', 'beanxone-wild'],
      ]) {
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'articles',
          data: { title, slug, body: doc([]) },
          actorId: ctx.actor.id,
        })
      }
      const titles = async (query: string) =>
        (
          await searchLinkTargets(ctx.site.id, {
            query,
            locale: 'nl',
            limit: 8,
            enabledOnly: true,
          })
        ).entries.map((hit) => hit.title)
      expect(await titles('50%')).toEqual(['50% Arabica'])
      expect(await titles('bean_one')).toEqual(['bean_one'])
      expect(await titles('bean_')).toEqual(['bean_one'])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('finds a title with quotes, which jsonb stores escaped', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      const quoted = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Het "beste" bonen',
          slug: 'beste-bonen-quoted',
          body: doc([]),
        },
        actorId: ctx.actor.id,
      })
      const found = await searchLinkTargets(ctx.site.id, {
        query: 'het "beste',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(found.entries.map((hit) => hit.entryId)).toEqual([quoted.id])
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('keeps a path with a query string a plain link; a fragment alone can still be an entry link', async () => {
    const { ctx, about } = await setup('query')
    try {
      const plain: [string, string][] = [
        [
          'http://localhost:3999/info/over-ons-query?variant=decaf',
          '/info/over-ons-query?variant=decaf',
        ],
        [
          '/info/over-ons-query?variant=decaf',
          '/info/over-ons-query?variant=decaf',
        ],
        [
          'http://localhost:3999/info/over-ons-query?variant=decaf#wie',
          '/info/over-ons-query?variant=decaf#wie',
        ],
      ]
      for (const [query, ownPath] of plain) {
        const found = await searchLinkTargets(ctx.site.id, {
          query,
          locale: 'nl',
          limit: 8,
          enabledOnly: true,
        })
        expect(found.resolved, query).toBeNull()
        expect(found.entries, query).toEqual([])
        expect(found.ownPath, query).toBe(ownPath)
      }

      const fragment = await searchLinkTargets(ctx.site.id, {
        query: 'http://localhost:3999/info/over-ons-query#wie',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(fragment.resolved).toEqual({
        entry: expect.objectContaining({ entryId: about.id }),
        anchor: 'wie',
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('never returns another site’s entries', async () => {
    const { ctx, coffee } = await setup('iso')
    const other = await createTestSite({ languages })
    try {
      await createTestCollection(other.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      const foreign = await createEntry({
        siteId: other.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Koffie uit Ethiopië',
          slug: 'koffie-ethiopie-iso',
          body: doc(['Ergens']),
        },
        actorId: other.actor.id,
      })
      const words = await searchLinkTargets(ctx.site.id, {
        query: 'koffie',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(words.entries.map((option) => option.entryId)).toEqual([coffee.id])
      const path = await searchLinkTargets(other.site.id, {
        query: '/blog/koffie-ethiopie-iso',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(path.resolved?.entry.entryId).toBe(foreign.id)
      // Both sites have a page at this path; each site resolves to its own entry.
      const crossed = await searchLinkTargets(ctx.site.id, {
        query: '/blog/koffie-ethiopie-iso',
        locale: 'nl',
        limit: 8,
        enabledOnly: true,
      })
      expect(crossed.resolved?.entry.entryId).toBe(coffee.id)
    } finally {
      await cleanupTestSite(other)
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('link targets: headings and checks', () => {
  it('lists the headings of the entry in the language of the link', async () => {
    const { ctx, coffee } = await setup('heads')
    try {
      const nl = await linkTargetHeadings(ctx.site.id, coffee.id, 'nl')
      expect(nl).toEqual({
        path: '/blog/koffie-ethiopie-heads',
        headings: [{ id: 'herkomst', text: 'Herkomst', level: 2 }],
      })
      const en = await linkTargetHeadings(ctx.site.id, coffee.id, 'en')
      expect(en).toEqual({
        path: '/news/coffee-ethiopia-heads',
        headings: [{ id: 'origin', text: 'Origin', level: 2 }],
      })
      expect(
        await linkTargetHeadings(ctx.site.id, 'missing-entry', 'nl'),
      ).toBeNull()
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('says which links still work in a language', async () => {
    const { ctx, coffee, about, old } = await setup('check')
    const other = await createTestSite({ languages })
    try {
      await createTestCollection(other.site.id, {
        key: 'articles',
        routePattern: '/blog/$slug',
      })
      const foreign = await createEntry({
        siteId: other.site.id,
        collectionKey: 'articles',
        data: { title: 'Ander', slug: 'ander-check', body: doc(['Kop']) },
        actorId: other.actor.id,
      })
      const results = await checkLinkTargets(ctx.site.id, 'en', [
        { entryId: coffee.id, anchor: 'origin' },
        { entryId: coffee.id, anchor: 'herkomst' },
        { entryId: coffee.id, anchor: null },
        { entryId: about.id, anchor: null },
        { entryId: old.id, anchor: null },
        { entryId: foreign.id, anchor: null },
        { entryId: crypto.randomUUID(), anchor: null },
      ])
      expect(results.map((result) => result.state)).toEqual([
        'ok',
        'missing-section',
        'ok',
        'ok',
        'gone',
        'gone',
        'gone',
      ])
      expect(results[4]?.target).toMatchObject({ status: 'archived' })
      expect(results[5]?.target).toBeNull()

      // The Dutch heading does not exist in English, but it does in Dutch.
      const dutch = await checkLinkTargets(ctx.site.id, 'nl', [
        { entryId: coffee.id, anchor: 'herkomst' },
      ])
      expect(dutch[0]?.state).toBe('ok')
    } finally {
      await cleanupTestSite(other)
      await cleanupTestSite(ctx)
    }
  })

  it('treats an entry that was deleted as gone', async () => {
    const { ctx, about } = await setup('deleted')
    try {
      await db.delete(entry).where(eq(entry.id, about.id))
      const [result] = await checkLinkTargets(ctx.site.id, 'nl', [
        { entryId: about.id, anchor: null },
      ])
      expect(result).toEqual({
        entryId: about.id,
        anchor: null,
        state: 'gone',
        target: null,
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('resolveMarkdownLinkTargets: queries', () => {
  it('makes the same queries whatever the number of links of each kind', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'pages',
        routePattern: '/pages/$slug',
      })
      const page = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'pages',
        data: { title: 'Contact', slug: 'contact', body: doc([]) },
        actorId: ctx.actor.id,
      })
      const countQueries = async (markdown: string) => {
        const spy = vi.spyOn(db, 'select')
        try {
          await resolveMarkdownLinkTargets(ctx.site.id, null, [markdown])
          return spy.mock.calls.length
        } finally {
          spy.mockRestore()
        }
      }
      const oneId = await countQueries(`[a](entry:${page.id})`)
      const manyIds = await countQueries(
        `[a](entry:${page.id}) [b](entry:${page.id}#x) [c](entry:${page.id})`,
      )
      const onePath = await countQueries('[a](/pages/contact)')
      const manyPaths = await countQueries(
        '[a](/pages/contact) [b](/pages/other) [c](/pages/more)',
      )
      const mixed = await countQueries(
        `[a](entry:${page.id}) [b](/pages/contact)`,
      )
      expect(manyIds).toBe(oneId)
      expect(manyPaths).toBe(onePath)
      // The site, its link target sites and the entries by id; the site and the entries by path.
      expect(oneId).toBe(3)
      expect(onePath).toBe(2)
      expect(mixed).toBe(4)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)(
  'resolveMarkdownLinkTargets: a path in the language of the text',
  () => {
    const trilingual = { main: 'nl', all: ['nl', 'en', 'de'] }

    it('links a path to the entry whose path in that language matches, not to a newer entry in another language', async () => {
      const ctx = await createTestSite({ languages: trilingual })
      try {
        await createTestCollection(ctx.site.id, {
          key: 'pages',
          routePattern: '/pages/$slug',
        })
        // Slugs are unique per collection, so the other entry lives in a second
        // collection with the same route.
        await createTestCollection(ctx.site.id, {
          key: 'stories',
          routePattern: '/pages/$slug',
        })
        // Dutch path /pages/contact.
        const contact = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'pages',
          data: { title: 'Contact', slug: 'contact', body: doc([]) },
          actorId: ctx.actor.id,
        })
        // Dutch path /pages/anders, German path /pages/contact. Edited after `contact`.
        const anders = await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'stories',
          data: {
            title: 'Anders',
            slug: 'anders',
            body: doc([]),
            $i18n: {
              de: {
                title: 'Kontakt',
                $slug: 'contact',
                body: doc(['Kontakt']),
              },
            },
          },
          actorId: ctx.actor.id,
        })
        await db
          .update(entry)
          .set({ updatedAt: new Date('2020-01-01') })
          .where(eq(entry.id, contact.id))
        expect(anders.id).not.toBe(contact.id)

        const targets = await resolveMarkdownLinkTargets(ctx.site.id, 'nl', [
          '[Contact](/pages/contact)',
        ])
        expect(targets.get('/pages/contact')).toMatchObject({
          entryId: contact.id,
          collection: 'pages',
          href: '/pages/contact',
        })
      } finally {
        await cleanupTestSite(ctx)
      }
    })

    it('keeps a path plain and says so when more than one entry matches in the language of the text', async () => {
      const ctx = await createTestSite({ languages: trilingual })
      try {
        await createTestCollection(ctx.site.id, {
          key: 'pages',
          routePattern: '/pages/$slug',
        })
        await createTestCollection(ctx.site.id, {
          key: 'stories',
          routePattern: '/pages/$slug',
        })
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'pages',
          data: { title: 'Dup', slug: 'dup', body: doc([]) },
          actorId: ctx.actor.id,
        })
        await createEntry({
          siteId: ctx.site.id,
          collectionKey: 'stories',
          data: { title: 'Dup', slug: 'dup', body: doc([]) },
          actorId: ctx.actor.id,
        })

        const targets = await resolveMarkdownLinkTargets(ctx.site.id, 'nl', [
          '[x](/pages/dup)',
        ])
        expect(targets.get('/pages/dup')).toEqual({ ambiguous: true })
      } finally {
        await cleanupTestSite(ctx)
      }
    })

    it('keeps a path plain when more than one entry matches only in another language', async () => {
      const ctx = await createTestSite({ languages: trilingual })
      try {
        await createTestCollection(ctx.site.id, {
          key: 'pages',
          routePattern: '/pages/$slug',
        })
        await createTestCollection(ctx.site.id, {
          key: 'stories',
          routePattern: '/pages/$slug',
        })
        for (const key of ['pages', 'stories']) {
          await createEntry({
            siteId: ctx.site.id,
            collectionKey: key,
            data: {
              title: key,
              slug: `${key}-main`,
              body: doc([]),
              $i18n: { de: { title: key, $slug: 'dup', body: doc(['Dup']) } },
            },
            actorId: ctx.actor.id,
          })
        }

        const targets = await resolveMarkdownLinkTargets(ctx.site.id, 'nl', [
          '[x](/pages/dup)',
        ])
        expect(targets.get('/pages/dup')).toEqual({ ambiguous: true })
      } finally {
        await cleanupTestSite(ctx)
      }
    })
  },
)
