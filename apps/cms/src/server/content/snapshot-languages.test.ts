import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { asset, collection, entry } from '#/db/schema'
import type { EntryData, Field } from '#/lib/types'

import { createEntry, publishEntry, updateDraft } from './entries.ts'
import { upsertGlobal } from './globals.ts'
import { buildPreviewEntry, buildPreviewGlobal, buildSnapshot } from './snapshot.ts'
import {
  createTestCollection,
  createTestGlobal,
  createTestSite,
  globalFields,
  cleanupTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

function vacancyFields(): Field[] {
  return [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'slug', label: 'Slug', type: 'slug', required: true },
    { key: 'summary', label: 'Summary', type: 'textarea', translatable: true },
    { key: 'salary', label: 'Salary', type: 'number' },
    { key: 'heroImage', label: 'Hero image', type: 'image' },
  ]
}

/** Keys sorted recursively, as the snapshot hash does before JSON.stringify. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key])
    return out
  }
  return value
}

async function setupVacancies(suffix: string, siteId: string) {
  const [image] = await db
    .insert(asset)
    .values({
      organizationId: (
        await db.query.site.findFirst({ where: (s, { eq }) => eq(s.id, siteId) })
      )!.organizationId,
      storageKey: `org-${suffix}/hero-${suffix}.png`,
      originalFilename: 'hero.png',
      mimeType: 'image/png',
      size: 1,
      width: 10,
      height: 10,
      altText: 'Dutch alt',
      altI18n: { en: 'English alt' },
    })
    .returning()
  return image!
}

describe.skipIf(!hasDb)('buildSnapshot with content languages', () => {
  it('ships each complete language with its slug, view and alt text', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'vacancies',
        routePattern: '/vacancies/$slug',
        fields: vacancyFields(),
        localizedRoutes: { en: '/jobs/$slug' },
        requiredLanguages: ['en'],
      })
      const image = await setupVacancies(ctx.suffix, ctx.site.id)
      const nlSlug = `backend-nl-${ctx.suffix}`
      const enSlug = `backend-en-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'vacancies',
        data: {
          title: 'Backend ontwikkelaar',
          slug: nlSlug,
          summary: 'Nederlandse samenvatting',
          salary: 4000,
          heroImage: image.id,
          $i18n: {
            en: {
              title: 'Backend developer',
              summary: 'English summary',
              $slug: enSlug,
              $seo: { description: 'English description' },
            },
            // Incomplete: no title. Never shipped.
            fr: { summary: 'Résumé' },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const snapshot = result.snapshot
      expect(snapshot.languages).toEqual(languages)
      const item = snapshot.collections.vacancies?.[0]
      expect(item).toBeDefined()
      if (!item) return

      expect(item.locale).toBe('nl')
      expect(item.slug).toBe(nlSlug)
      expect(item.data).toMatchObject({
        title: 'Backend ontwikkelaar',
        heroImage: { alt: 'Dutch alt' },
      })
      expect(Object.keys(item.locales ?? {})).toEqual(['nl', 'en'])
      expect(item.locales).not.toHaveProperty('fr')

      const en = item.locales?.en
      expect(en?.slug).toBe(enSlug)
      expect(en?.data).toMatchObject({
        title: 'Backend developer',
        summary: 'English summary',
        salary: 4000,
        slug: enSlug,
        heroImage: { alt: 'English alt' },
      })
      expect(en?.seo).toMatchObject({
        description: 'English description',
        canonicalUrl: `${new URL(ctx.site.productionUrl).origin}/jobs/${enSlug}`,
      })

      // Language internals never reach shipped data.
      for (const view of [item.data, en?.data, item.locales?.nl?.data]) {
        expect(view).not.toHaveProperty('$i18n')
        expect(view).not.toHaveProperty('$locale')
        expect(view).not.toHaveProperty('$slug')
        expect(view).not.toHaveProperty('$seo')
      }

      expect(snapshot.schema?.vacancies).toMatchObject({
        route: '/vacancies/$slug',
        routes: { en: '/jobs/$slug' },
        requiredLanguages: ['en'],
      })
      expect(
        snapshot.schema?.vacancies?.fields.find((f) => f.key === 'summary'),
      ).toMatchObject({ translatable: true })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('reports a required language that is missing a required field', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const col = await createTestCollection(ctx.site.id, {
        key: 'vacancies',
        routePattern: '/vacancies/$slug',
        fields: vacancyFields(),
      })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'vacancies',
        data: {
          title: 'Backend ontwikkelaar',
          slug: `gap-${ctx.suffix}`,
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      await db
        .update(collection)
        .set({ requiredLanguages: ['en'] })
        .where(eq(collection.id, col.id))

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors).toContain(
        `vacancies/gap-${ctx.suffix}: English is missing: Title`,
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('normalises data stamped with $locale so the base is the main language', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'vacancies',
        routePattern: '/vacancies/$slug',
        fields: vacancyFields(),
      })
      const slug = `stamp-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'vacancies',
        data: { title: 'Backend ontwikkelaar', slug },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      // Written before the main language changed: base is English now.
      await db
        .update(entry)
        .set({
          publishedData: {
            title: 'Backend developer',
            slug,
            $locale: 'en',
            $i18n: { nl: { title: 'Backend ontwikkelaar' } },
          } satisfies EntryData,
        })
        .where(eq(entry.id, created.id))

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const item = result.snapshot.collections.vacancies?.[0]
      expect(item?.locale).toBe('nl')
      expect(item?.data.title).toBe('Backend ontwikkelaar')
      expect(item?.locales?.en?.data.title).toBe('Backend developer')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('hashes languages and locales, so a translation change moves the hash', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'vacancies',
        routePattern: '/vacancies/$slug',
        fields: vacancyFields(),
      })
      const slug = `hash-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'vacancies',
        data: {
          title: 'Backend ontwikkelaar',
          slug,
          $i18n: { en: { title: 'Backend developer' } },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      const before = await buildSnapshot(ctx.site.id)
      expect(before.ok).toBe(true)
      if (!before.ok) return

      await db
        .update(entry)
        .set({
          publishedData: {
            title: 'Backend ontwikkelaar',
            slug,
            $i18n: { en: { title: 'Backend engineer' } },
          },
        })
        .where(eq(entry.id, created.id))
      const after = await buildSnapshot(ctx.site.id)
      expect(after.ok).toBe(true)
      if (!after.ok) return
      expect(after.hash).not.toBe(before.hash)
      expect(after.snapshot.collections.vacancies?.[0]?.locales?.en?.data.title)
        .toBe('Backend engineer')
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('ships a section per complete language', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const { collection: section, entry: row } = await createTestGlobal(
        ctx.site.id,
        { fields: globalFields(), key: 'contact' },
      )
      await updateDraft(
        row.id,
        {
          email: 'info@example.com',
          phone: '+31',
          $i18n: { en: { email: 'hello@example.com' } },
        },
        ctx.actor.id,
        row.draftVersion,
      )
      await publishEntry(row.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const global = result.snapshot.globals?.[section.key]
      expect(global?.locale).toBe('nl')
      expect(global?.data).toMatchObject({ email: 'info@example.com' })
      expect(Object.keys(global?.locales ?? {})).toEqual(['nl', 'en'])
      expect(global?.locales?.en?.data).toMatchObject({
        email: 'hello@example.com',
      })
      expect(global?.locales?.en).not.toHaveProperty('slug')
      expect(result.snapshot.languages).toEqual(languages)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('keeps a single-language snapshot and hash exactly as before', async () => {
    const ctx = await createTestSite()
    try {
      // Language settings on the collection are ignored without site languages.
      await createTestCollection(ctx.site.id, {
        key: 'vacancies',
        routePattern: '/vacancies/$slug',
        fields: vacancyFields(),
        requiredLanguages: ['en'],
        localizedRoutes: { en: '/jobs/$slug' },
      })
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'vacancies',
        data: { title: 'Backend developer', slug: `solo-${ctx.suffix}` },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)

      const result = await buildSnapshot(ctx.site.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const { snapshot } = result
      expect(snapshot).not.toHaveProperty('languages')
      const item = snapshot.collections.vacancies?.[0]
      expect(item).not.toHaveProperty('locale')
      expect(item).not.toHaveProperty('locales')
      const schema = snapshot.schema?.vacancies
      expect(schema).toMatchObject({ route: '/vacancies/$slug', label: 'Articles' })
      expect(schema).not.toHaveProperty('routes')
      expect(schema).not.toHaveProperty('requiredLanguages')
      const byKey = (fields: Field[]) =>
        [...fields].sort((a, b) => a.key.localeCompare(b.key))
      expect(byKey(schema?.fields ?? [])).toEqual(byKey(vacancyFields()))
      // The hash of a site without sections is the sha256 of its collections.
      expect(result.hash).toBe(
        createHash('sha256')
          .update(JSON.stringify(sortKeys(snapshot.collections)))
          .digest('hex'),
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('preview with content languages', () => {
  it('resolves the requested language against the draft, with per-language status', async () => {
    const ctx = await createTestSite({ languages })
    try {
      await createTestCollection(ctx.site.id, {
        key: 'vacancies',
        routePattern: '/vacancies/$slug',
        fields: vacancyFields(),
      })
      const slug = `preview-${ctx.suffix}`
      const enSlug = `preview-en-${ctx.suffix}`
      const created = await createEntry({
        siteId: ctx.site.id,
        collectionKey: 'vacancies',
        data: {
          title: 'Backend ontwikkelaar',
          slug,
          $i18n: {
            en: { title: 'Backend developer', $slug: enSlug },
            fr: { summary: 'Résumé' },
          },
        },
        actorId: ctx.actor.id,
      })
      await publishEntry(created.id, ctx.actor.id)
      // A draft edit that is not published yet must be what preview shows.
      const [row] = await db.select().from(entry).where(eq(entry.id, created.id))
      await updateDraft(
        created.id,
        {
          title: 'Backend ontwikkelaar',
          slug,
          $i18n: { en: { title: 'Draft English', $slug: enSlug } },
        },
        ctx.actor.id,
        row!.draftVersion,
      )

      const en = await buildPreviewEntry(ctx.site.id, 'vacancies', slug, 'en')
      expect(en?.locale).toBe('en')
      expect(en?.isFallback).toBe(false)
      expect(en?.slug).toBe(enSlug)
      expect(en?.data.title).toBe('Draft English')
      // `locales` has the snapshot shape (complete languages only).
      expect(Object.keys(en?.locales ?? {})).toEqual(['nl', 'en'])
      expect(en?.locales?.en).toMatchObject({ slug: enSlug, data: { title: 'Draft English' } })
      // Per-language completeness sits beside it.
      expect(en?.localeStatus).toEqual({
        nl: { complete: true, missing: [] },
        en: { complete: true, missing: [] },
        fr: { complete: false, missing: ['title'] },
      })

      const fr = await buildPreviewEntry(ctx.site.id, 'vacancies', slug, 'fr')
      expect(fr).toMatchObject({ locale: 'nl', isFallback: true, slug })
      expect(fr?.data.title).toBe('Backend ontwikkelaar')

      const none = await buildPreviewEntry(ctx.site.id, 'vacancies', slug)
      expect(none).toMatchObject({ locale: 'nl', isFallback: false })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('resolves a section preview per language', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const { collection: section, entry: row } = await createTestGlobal(
        ctx.site.id,
        { fields: globalFields(), key: 'contact' },
      )
      await updateDraft(
        row.id,
        {
          email: 'info@example.com',
          $i18n: { en: { email: 'hello@example.com' } },
        },
        ctx.actor.id,
        row.draftVersion,
      )

      const en = await buildPreviewGlobal(ctx.site.id, section.key, 'en')
      expect(en).toMatchObject({ locale: 'en', isFallback: false })
      expect(en?.data).toMatchObject({ email: 'hello@example.com' })
      const fr = await buildPreviewGlobal(ctx.site.id, section.key, 'fr')
      expect(fr).toMatchObject({ locale: 'nl', isFallback: true })
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('section SEO off with language slots', () => {
  it('strips $seo from every language slot when SEO is turned off', async () => {
    const ctx = await createTestSite({ languages })
    try {
      const { collection: section, entry: row } = await createTestGlobal(
        ctx.site.id,
        { fields: globalFields(), seoEnabled: true, key: 'contact' },
      )
      await updateDraft(
        row.id,
        {
          email: 'info@example.com',
          $seo: { description: 'Base' },
          $i18n: { en: { email: 'hello@example.com', $seo: { description: 'EN' } } },
        },
        ctx.actor.id,
        row.draftVersion,
      )
      await upsertGlobal(ctx.site.id, {
        key: section.key,
        label: section.label,
        fields: globalFields(),
        seo: false,
      })
      const [after] = await db.select().from(entry).where(eq(entry.id, row.id))
      expect(after?.draftData).not.toHaveProperty('$seo')
      expect(after?.draftData).toMatchObject({
        $i18n: { en: { email: 'hello@example.com' } },
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
