import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { asset } from '#/db/schema'
import {
  getSitesManifest,
  postSitesManifest,
} from '#/routes/api/sites/manifest'
import { getSite } from '#/server/admin/sites'

import { getCollection, syncManifest, upsertCollection } from './collections.ts'
import { ValidationError } from './errors.ts'
import { updateAsset } from '#/server/assets'
import { cleanupTestSite, createTestSite, withTestSite } from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

const fields = [
  { key: 'title', label: 'Title', type: 'text' as const, required: true },
]

describe.skipIf(!hasDb)('manifest languages', () => {
  it('applies languages, routes and required languages on push', async () => {
    await withTestSite(async (ctx) => {
      await syncManifest(ctx.site.id, {
        languages: { main: 'nl', all: ['nl', 'en'] },
        collections: {
          vacancies: {
            route: '/vacancies/$slug',
            routes: { nl: '/vacatures/$slug' },
            requiredLanguages: ['en'],
            fields,
          },
        },
        globals: {
          companyInfo: {
            fields: [
              { key: 'email', label: 'Email', type: 'text', required: true },
            ],
            requiredLanguages: ['en'],
          },
        },
      })
      const row = await getSite(ctx.site.id)
      expect(row?.languages).toEqual({ main: 'nl', all: ['nl', 'en'] })
      const vacancies = await getCollection(ctx.site.id, 'vacancies')
      expect(vacancies?.localizedRoutes).toEqual({ nl: '/vacatures/$slug' })
      expect(vacancies?.requiredLanguages).toEqual(['en'])
    })
  })

  it('leaves the site languages alone when the push omits them', async () => {
    const ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en'] },
    })
    try {
      await syncManifest(ctx.site.id, {
        collections: { vacancies: { route: '/vacancies/$slug', fields } },
      })
      expect((await getSite(ctx.site.id))?.languages).toEqual({
        main: 'nl',
        all: ['nl', 'en'],
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('round-trips languages, routes and required languages through GET', async () => {
    const ctx = await createTestSite({
      languages: { main: 'nl', all: ['nl', 'en'] },
    })
    try {
      await syncManifest(ctx.site.id, {
        collections: {
          vacancies: {
            route: '/vacancies/$slug',
            routes: { nl: '/vacatures/$slug' },
            requiredLanguages: ['en'],
            fields,
          },
        },
      })
      const response = await getSitesManifest(
        new Request('http://localhost/api/sites/manifest', {
          headers: { Authorization: `Bearer ${ctx.token}` },
        }),
      )
      const body = (await response.json()) as {
        languages?: unknown
        collections: Record<string, Record<string, unknown>>
      }
      expect(body.languages).toEqual({ main: 'nl', all: ['nl', 'en'] })
      expect(body.collections.vacancies).toMatchObject({
        routes: { nl: '/vacatures/$slug' },
        requiredLanguages: ['en'],
      })
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('omits language keys from GET on a single-language site', async () => {
    const ctx = await createTestSite()
    try {
      const response = await getSitesManifest(
        new Request('http://localhost/api/sites/manifest', {
          headers: { Authorization: `Bearer ${ctx.token}` },
        }),
      )
      const body = (await response.json()) as Record<string, unknown>
      expect('languages' in body).toBe(false)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rejects an invalid language code in a push', async () => {
    const ctx = await createTestSite()
    try {
      const response = await postSitesManifest(
        new Request('http://localhost/api/sites/manifest', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ctx.schemaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            languages: { main: 'not a tag!!', all: ['not a tag!!'] },
            collections: {},
          }),
        }),
      )
      expect(response.status).toBe(400)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rejects a main language that is not in the list in a push', async () => {
    const ctx = await createTestSite()
    try {
      await expect(
        syncManifest(ctx.site.id, {
          languages: { main: 'fr', all: ['nl', 'en'] },
          collections: {},
        }),
      ).rejects.toBeInstanceOf(ValidationError)
      expect((await getSite(ctx.site.id))?.languages).toBeNull()
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})

describe.skipIf(!hasDb)('upsertCollection languages', () => {
  it('persists required languages and localized routes, and keeps them when omitted', async () => {
    await withTestSite(async (ctx) => {
      await upsertCollection(ctx.site.id, {
        key: 'vacancies',
        label: 'Vacancies',
        routePattern: '/vacancies/$slug',
        fields,
        requiredLanguages: ['en'],
        localizedRoutes: { nl: '/vacatures/$slug' },
      })
      await upsertCollection(ctx.site.id, {
        key: 'vacancies',
        label: 'Vacancies',
        routePattern: '/vacancies/$slug',
        fields,
      })
      const row = await getCollection(ctx.site.id, 'vacancies')
      expect(row?.requiredLanguages).toEqual(['en'])
      expect(row?.localizedRoutes).toEqual({ nl: '/vacatures/$slug' })
    })
  })
})

describe.skipIf(!hasDb)('asset alt per language', () => {
  async function createAsset(orgId: string, suffix: string) {
    const [row] = await db
      .insert(asset)
      .values({
        organizationId: orgId,
        storageKey: `key-${suffix}`,
        originalFilename: 'a.png',
        mimeType: 'image/png',
        size: 10,
        altText: 'Main alt',
      })
      .returning()
    return row
  }

  it('writes the translation to altI18n and deletes it on an empty value', async () => {
    await withTestSite(async (ctx) => {
      const row = await createAsset(ctx.org.id, ctx.suffix)
      const translated = await updateAsset(
        row.id,
        { altText: 'Foto', locale: 'nl-BE', mainLocale: 'en' },
        ctx.org.id,
      )
      expect(translated.altText).toBe('Main alt')
      expect(translated.altI18n).toEqual({ 'nl-BE': 'Foto' })

      const cleared = await updateAsset(
        row.id,
        { altText: '', locale: 'nl-BE', mainLocale: 'en' },
        ctx.org.id,
      )
      expect(cleared.altI18n).toEqual({})
    })
  })

  it('writes alt when the locale is the main language', async () => {
    await withTestSite(async (ctx) => {
      const row = await createAsset(ctx.org.id, `${ctx.suffix}-m`)
      const updated = await updateAsset(
        row.id,
        { altText: 'New main', locale: 'en', mainLocale: 'en' },
        ctx.org.id,
      )
      expect(updated.altText).toBe('New main')
      expect(updated.altI18n).toEqual({})
    })
  })
})
