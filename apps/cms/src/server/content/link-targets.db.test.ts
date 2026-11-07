import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'

import { archiveEntry, createEntry, publishEntry } from './entries.ts'
import {
  checkLinkTargets,
  linkTargetHeadings,
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
