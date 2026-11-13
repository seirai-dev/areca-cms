import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { buildJob, collection, publication } from '#/db/schema'
import type { SiteManifest, Snapshot } from '#/lib/types'
import { createEntry, updateDraft } from '#/server/content/entries'
import { signPreviewToken } from '#/server/content/preview-token'
import {
  getSitesManifest,
  postSitesManifest,
} from '#/routes/api/sites/manifest'
import { getSitesPreview } from '#/routes/api/sites/preview'
import { getSitesSnapshotCurrent } from '#/routes/api/sites/snapshot/current'

import {
  createTestCollection,
  createTestGlobal,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe.skipIf(!hasDb)('site API routes', () => {
  it('revalidates a stored publication by ETag from its stored asset flag', async () => {
    await withTestSite(async (fixtures) => {
      const pull = (headers: Record<string, string> = {}) =>
        getSitesSnapshotCurrent(
          new Request('http://cms.test/api/sites/snapshot/current', {
            headers: { ...bearer(fixtures.token), ...headers },
          }),
        )
      const snapshot: Snapshot = {
        publicationId: '',
        siteKey: fixtures.site.slug,
        createdAt: '2026-01-01T00:00:00.000Z',
        hash: 'hash-old',
        collections: {},
      }
      const [old] = await db
        .insert(publication)
        .values({
          siteId: fixtures.site.id,
          snapshot,
          snapshotHash: 'hash-old',
          status: 'live',
        })
        .returning()
      expect(old.hasAssets).toBe(false)
      const legacy = await pull({ 'If-None-Match': '*' })
      expect(legacy.status).toBe(200)
      expect(legacy.headers.get('ETag')).toBeNull()

      const [stored] = await db
        .insert(publication)
        .values({
          siteId: fixtures.site.id,
          snapshot: { ...snapshot, hash: 'hash-new', assets: [] },
          snapshotHash: 'hash-new',
          status: 'live',
        })
        .returning()
      expect(stored.hasAssets).toBe(true)
      const first = await pull()
      const etag = first.headers.get('ETag')
      expect(etag).toMatch(/^"[0-9a-f]{40}"$/)
      expect(((await first.json()) as Snapshot).publicationId).toBe(stored.id)
      const again = await pull({ 'If-None-Match': etag! })
      expect(again.status).toBe(304)
    })
  })

  it('separates build and schema tokens and rejects unsafe identifiers', async () => {
    await withTestSite(async (fixtures) => {
      const post = (token: string, collections: unknown) =>
        postSitesManifest(
          new Request('http://cms.test/api/sites/manifest', {
            method: 'POST',
            headers: { ...bearer(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ collections }),
          }),
        )
      expect((await post(fixtures.token, {})).status).toBe(401)
      expect(
        (
          await getSitesSnapshotCurrent(
            new Request('http://cms.test/api/sites/snapshot/current', {
              headers: bearer(fixtures.schemaToken),
            }),
          )
        ).status,
      ).toBe(401)
      for (const key of ['../escape', 'manifest', '__proto__', 'CON'])
        expect(
          (
            await post(fixtures.schemaToken, {
              [key]: { route: '/x', fields: [] },
            })
          ).status,
        ).toBe(400)
      expect(
        (
          await post(fixtures.schemaToken, {
            articles: {
              route: '/x',
              fields: [
                { key: 'title', label: 'A', type: 'text' },
                { key: 'title', label: 'B', type: 'text' },
              ],
            },
          })
        ).status,
      ).toBe(400)
    })
  })

  it('syncs a manifest, serves the current snapshot, and returns a preview', async () => {
    await withTestSite(async (fixtures) => {
      await createTestCollection(fixtures.site.id)

      const unauthorized = await postSitesManifest(
        new Request('http://cms.test/api/sites/manifest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collections: {} }),
        }),
      )
      expect(unauthorized.status).toBe(401)

      const badBody = await postSitesManifest(
        new Request('http://cms.test/api/sites/manifest', {
          method: 'POST',
          headers: {
            ...bearer(fixtures.schemaToken),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nope: true }),
        }),
      )
      expect(badBody.status).toBe(400)
      const badJson = (await badBody.json()) as { issues?: unknown }
      expect(badJson.issues).toBeDefined()

      const synced = await postSitesManifest(
        new Request('http://cms.test/api/sites/manifest', {
          method: 'POST',
          headers: {
            ...bearer(fixtures.schemaToken),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            collections: {
              articles: {
                route: '/blog/$slug',
                label: 'Articles',
                fields: [
                  {
                    key: 'title',
                    label: 'Title',
                    type: 'text',
                    required: true,
                  },
                  { key: 'slug', label: 'Slug', type: 'slug', required: true },
                  {
                    key: 'body',
                    label: 'Body',
                    type: 'richtext',
                    required: true,
                  },
                ],
              },
            },
          }),
        }),
      )
      expect(synced.status).toBe(200)
      expect(await synced.json()).toEqual({ ok: true })

      const missing = await getSitesSnapshotCurrent(
        new Request('http://cms.test/api/sites/snapshot/current', {
          headers: bearer(fixtures.token),
        }),
      )
      expect(missing.status).toBe(404)

      const snapshot: Snapshot = {
        publicationId: '',
        siteKey: fixtures.site.slug,
        createdAt: '2026-01-01T00:00:00.000Z',
        hash: 'hash-live',
        collections: { articles: [] },
      }

      const [livePub] = await db
        .insert(publication)
        .values({
          siteId: fixtures.site.id,
          snapshot,
          snapshotHash: 'hash-live',
          status: 'live',
        })
        .returning()

      const buildingSnapshot: Snapshot = {
        ...snapshot,
        hash: 'hash-building',
      }
      const [buildingPub] = await db
        .insert(publication)
        .values({
          siteId: fixtures.site.id,
          snapshot: buildingSnapshot,
          snapshotHash: 'hash-building',
          status: 'building',
        })
        .returning()

      await db.insert(buildJob).values({
        siteId: fixtures.site.id,
        publicationId: buildingPub.id,
        status: 'deploying',
      })

      const current = await getSitesSnapshotCurrent(
        new Request('http://cms.test/api/sites/snapshot/current', {
          headers: bearer(fixtures.token),
        }),
      )
      expect(current.status).toBe(200)
      const currentJson = (await current.json()) as Snapshot
      expect(currentJson.publicationId).toBe(livePub.id)
      expect(currentJson.hash).toBe('hash-live')
      expect(currentJson.publicationId).not.toBe(buildingPub.id)

      const created = await createEntry({
        siteId: fixtures.site.id,
        collectionKey: 'articles',
        data: {
          title: 'Draft preview',
          slug: `preview-${fixtures.suffix}`,
          body: sampleRichText,
        },
        actorId: fixtures.actor.id,
      })

      const token = signPreviewToken({
        siteId: fixtures.site.id,
        collection: 'articles',
        slug: created.slug,
        secret: fixtures.previewSecret,
      })

      const preview = await getSitesPreview(
        new Request(
          `http://cms.test/api/sites/preview?token=${encodeURIComponent(token)}`,
        ),
      )
      expect(preview.status).toBe(200)
      expect(preview.headers.get('X-Robots-Tag')).toBe('noindex')
      const previewJson = (await preview.json()) as {
        kind: string
        collection: string
        slug: string
        entry: { id: string }
      }
      expect(previewJson.kind).toBe('entry')
      expect(previewJson.collection).toBe('articles')
      expect(previewJson.slug).toBe(created.slug)
      expect(previewJson.entry.id).toBe(created.id)

      const badPreview = await getSitesPreview(
        new Request('http://cms.test/api/sites/preview?token=not-a-token'),
      )
      expect(badPreview.status).toBe(401)
    })
  })

  it('serves enabled collections from the database over GET', async () => {
    await withTestSite(async (fixtures) => {
      const unauthorized = await getSitesManifest(
        new Request('http://cms.test/api/sites/manifest'),
      )
      expect(unauthorized.status).toBe(401)
      expect(await unauthorized.json()).toEqual({ error: 'Unauthorized' })

      await db.insert(collection).values([
        {
          siteId: fixtures.site.id,
          key: 'articles',
          label: 'Articles',
          routePattern: '/blog/$slug',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
          ],
          enabled: true,
        },
        {
          siteId: fixtures.site.id,
          key: 'drafts',
          label: 'Drafts',
          routePattern: '/drafts/$slug',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
          ],
          enabled: false,
        },
      ])

      const response = await getSitesManifest(
        new Request('http://cms.test/api/sites/manifest', {
          headers: bearer(fixtures.token),
        }),
      )
      expect(response.status).toBe(200)
      const json = (await response.json()) as SiteManifest
      expect(Object.keys(json.collections)).toEqual(['articles'])
      expect(json.collections.articles.route).toBe('/blog/$slug')
      expect(json.collections.articles.label).toBe('Articles')
      expect(
        json.collections.articles.fields.map((field) => field.key),
      ).toContain('slug')
    })
  })

  it('ignores an active job that points at another site publication', async () => {
    await withTestSite(async (siteA) => {
      await withTestSite(async (siteB) => {
        const snapshotA: Snapshot = {
          publicationId: '',
          siteKey: siteA.site.slug,
          createdAt: '2026-01-01T00:00:00.000Z',
          hash: 'hash-a',
          collections: { articles: [] },
        }
        const snapshotB: Snapshot = {
          ...snapshotA,
          siteKey: siteB.site.slug,
          hash: 'hash-b',
        }

        const [liveA] = await db
          .insert(publication)
          .values({
            siteId: siteA.site.id,
            snapshot: snapshotA,
            snapshotHash: 'hash-a',
            status: 'live',
          })
          .returning()
        const [foreign] = await db
          .insert(publication)
          .values({
            siteId: siteB.site.id,
            snapshot: snapshotB,
            snapshotHash: 'hash-b',
            status: 'building',
          })
          .returning()

        await db.insert(buildJob).values({
          siteId: siteA.site.id,
          publicationId: foreign.id,
          status: 'deploying',
        })

        const current = await getSitesSnapshotCurrent(
          new Request('http://cms.test/api/sites/snapshot/current', {
            headers: bearer(siteA.token),
          }),
        )
        expect(current.status).toBe(200)
        const json = (await current.json()) as Snapshot
        expect(json.publicationId).toBe(liveA.id)
        expect(json.hash).toBe('hash-a')
        expect(json.publicationId).not.toBe(foreign.id)
      })
    })
  })

  it('syncs site content sections through the manifest route and lists only enabled ones over GET', async () => {
    await withTestSite(async (fixtures) => {
      const post = (body: unknown) =>
        postSitesManifest(
          new Request('http://cms.test/api/sites/manifest', {
            method: 'POST',
            headers: {
              ...bearer(fixtures.schemaToken),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }),
        )
      const get = () =>
        getSitesManifest(
          new Request('http://cms.test/api/sites/manifest', {
            headers: bearer(fixtures.token),
          }),
        )

      const synced = await post({
        collections: {},
        globals: {
          companyInfo: {
            label: 'Company info',
            fields: [
              {
                key: 'email',
                label: 'Email',
                type: 'text',
                required: true,
                group: 'Contact',
              },
            ],
          },
        },
      })
      expect(synced.status).toBe(200)
      const json = (await (await get()).json()) as SiteManifest
      expect(Object.keys(json.globals ?? {})).toEqual(['companyInfo'])
      expect(json.globals?.companyInfo).toMatchObject({
        label: 'Company info',
        fields: [expect.objectContaining({ key: 'email', group: 'Contact' })],
      })

      const withdrawn = await post({ collections: {} })
      expect(withdrawn.status).toBe(200)
      const after = (await (await get()).json()) as Record<string, unknown>
      expect(after).not.toHaveProperty('globals')
      const [row] = await db
        .select()
        .from(collection)
        .where(eq(collection.siteId, fixtures.site.id))
      expect(row).toMatchObject({
        key: 'companyInfo',
        kind: 'global',
        enabled: false,
      })
    })
  })

  it('rejects section manifests with slug fields, unsafe keys, or an 81-character group', async () => {
    await withTestSite(async (fixtures) => {
      const post = (globals: unknown) =>
        postSitesManifest(
          new Request('http://cms.test/api/sites/manifest', {
            method: 'POST',
            headers: {
              ...bearer(fixtures.schemaToken),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ collections: {}, globals }),
          }),
        )
      const field = { key: 'email', label: 'Email', type: 'text' }

      expect(
        (
          await post({
            companyInfo: {
              label: 'Company info',
              fields: [{ key: 'slug', label: 'Slug', type: 'slug' }],
            },
          })
        ).status,
      ).toBe(400)
      for (const key of ['globals', '../escape', 'constructor'])
        expect(
          (await post({ [key]: { label: 'Section', fields: [field] } })).status,
        ).toBe(400)
      expect(
        (
          await post({
            companyInfo: {
              label: 'Company info',
              fields: [{ ...field, group: 'g'.repeat(81) }],
            },
          })
        ).status,
      ).toBe(400)
    })
  })

  it('previews a section draft through a global preview token', async () => {
    await withTestSite(async (fixtures) => {
      const section = await createTestGlobal(fixtures.site.id, {
        key: 'companyInfo',
      })
      await updateDraft(
        section.entry.id,
        { email: 'preview@x.test' },
        fixtures.actor.id,
        section.entry.draftVersion,
      )

      const token = signPreviewToken({
        siteId: fixtures.site.id,
        global: 'companyInfo',
        secret: fixtures.previewSecret,
      })
      const preview = await getSitesPreview(
        new Request(
          `http://cms.test/api/sites/preview?token=${encodeURIComponent(token)}`,
        ),
      )
      expect(preview.status).toBe(200)
      expect(preview.headers.get('X-Robots-Tag')).toBe('noindex')
      expect(await preview.json()).toMatchObject({
        kind: 'global',
        global: 'companyInfo',
        entry: { id: section.entry.id, data: { email: 'preview@x.test' } },
      })
    })
  })
})
