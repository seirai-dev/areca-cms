import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { buildJob, collection, publication } from '#/db/schema'
import type { SiteManifest, Snapshot } from '#/lib/types'
import { createEntry } from '#/server/content/entries'
import { signPreviewToken } from '#/server/content/preview-token'
import {
  getSitesManifest,
  postSitesManifest,
} from '#/routes/api/sites/manifest'
import { getSitesPreview } from '#/routes/api/sites/preview'
import { getSitesSnapshotCurrent } from '#/routes/api/sites/snapshot/current'

import {
  createTestCollection,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe.skipIf(!hasDb)('site API routes', () => {
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
        collection: string
        slug: string
        entry: { id: string }
      }
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
})
