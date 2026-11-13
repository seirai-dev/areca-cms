import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { entry, membership, user } from '#/db/schema'
import { createEntry, updateDraft } from '#/server/content/entries'
import { signPreviewToken } from '#/server/content/preview-token'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'
import { setCurrentSession } from '#/server/security/authz-state'
import type { TestSession } from '#/server/security/authz-state'
import { getSitesPreview } from '#/routes/api/sites/preview'

import { postLivePreview } from './live-preview'

vi.mock('#/lib/auth', async () =>
  (await import('#/server/security/authz-state')).fakeAuth(),
)
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))

const hasDb = Boolean(process.env.DATABASE_URL)

function sessionFor(userId: string, email: string): TestSession {
  return {
    session: {
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    user: {
      id: userId,
      name: 'Member',
      email,
      isAgencyAdmin: false,
      twoFactorEnabled: false,
    },
  }
}

/** A site with an owner (the test actor), an editor and one saved entry. */
async function fixture(languages?: { main: string; all: string[] }) {
  const ctx = await createTestSite({ languages: languages ?? null })
  await db.insert(membership).values({
    userId: ctx.actor.id,
    organizationId: ctx.org.id,
    role: 'owner',
  })
  const editorId = crypto.randomUUID()
  const editorEmail = `editor-${editorId}@test.local`
  await db.insert(user).values({
    id: editorId,
    name: 'Editor',
    email: editorEmail,
    emailVerified: true,
  })
  await db.insert(membership).values({
    userId: editorId,
    organizationId: ctx.org.id,
    role: 'editor',
  })
  await createTestCollection(ctx.site.id)
  const slug = `live-${ctx.suffix}`
  const created = await createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: { title: 'Saved title', slug, body: sampleRichText },
    actorId: ctx.actor.id,
  })
  return {
    ctx,
    slug,
    entryId: created.id,
    owner: sessionFor(ctx.actor.id, ctx.actor.email),
    editor: sessionFor(editorId, editorEmail),
    async cleanup() {
      await cleanupTestSite(ctx)
      await db.delete(user).where(eq(user.id, editorId))
    },
  }
}

async function rowOf(id: string) {
  const rows = await db.select().from(entry).where(eq(entry.id, id))
  return rows.at(0) ?? expect.fail('entry missing')
}

const post = (body: unknown) =>
  postLivePreview(
    new Request('http://cms.test/api/editor/live-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const getPreviewFor = (token: string) =>
  getSitesPreview(
    new Request(
      `http://cms.test/api/sites/preview?token=${encodeURIComponent(token)}`,
    ),
  )

describe.skipIf(!hasDb)('POST /api/editor/live-preview', () => {
  it('returns exactly the GET preview payload for the saved draft', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const row = await rowOf(f.entryId)
      const token = signPreviewToken({
        siteId: f.ctx.site.id,
        collection: 'articles',
        slug: f.slug,
        secret: f.ctx.previewSecret,
      })
      const fromGet = await getPreviewFor(token)
      expect(fromGet.status).toBe(200)

      const live = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: row.draftData,
      })

      expect(live.status).toBe(200)
      expect(live.headers.get('Cache-Control')).toBe('no-store, private')
      expect(await live.json()).toEqual(await fromGet.json())
    } finally {
      await f.cleanup()
    }
  })

  it('reflects unsaved values and writes nothing', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const before = await rowOf(f.entryId)

      const live = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { ...before.draftData, title: 'Unsaved title' },
      })

      expect(live.status).toBe(200)
      const json = (await live.json()) as {
        kind: string
        entry: { data: { title: string } }
      }
      expect(json.kind).toBe('entry')
      expect(json.entry.data.title).toBe('Unsaved title')

      const after = await rowOf(f.entryId)
      expect(after).toEqual(before)
    } finally {
      await f.cleanup()
    }
  })

  it('uses the unsaved slug from the slug field for the payload', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const before = await rowOf(f.entryId)
      const newSlug = `renamed-${f.ctx.suffix}`

      const live = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { ...before.draftData, slug: newSlug },
      })

      expect(live.status).toBe(200)
      const json = (await live.json()) as {
        slug: string
        entry: { slug: string }
      }
      expect(json.slug).toBe(newSlug)
      expect(json.entry.slug).toBe(newSlug)
      expect((await rowOf(f.entryId)).slug).toBe(f.slug)
    } finally {
      await f.cleanup()
    }
  })

  it('falls back to the saved slug when the unsaved slug is empty', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const before = await rowOf(f.entryId)

      const live = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { ...before.draftData, slug: '' },
      })

      expect(live.status).toBe(200)
      expect(((await live.json()) as { slug: string }).slug).toBe(f.slug)
    } finally {
      await f.cleanup()
    }
  })

  it('previews a translation in the requested language, like GET does', async () => {
    const f = await fixture({ main: 'nl', all: ['nl', 'en'] })
    try {
      setCurrentSession(f.owner)
      // English is complete (title and body), so it ships and is previewed.
      await db
        .update(entry)
        .set({
          draftData: {
            title: 'Saved title',
            slug: f.slug,
            body: sampleRichText,
            $i18n: {
              en: { title: 'Saved English', body: sampleRichText },
            },
          },
        })
        .where(eq(entry.id, f.entryId))
      const row = await rowOf(f.entryId)
      const token = signPreviewToken({
        siteId: f.ctx.site.id,
        collection: 'articles',
        slug: f.slug,
        secret: f.ctx.previewSecret,
        locale: 'en',
      })
      const fromGet = await getPreviewFor(token)

      const live = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        locale: 'en',
        data: row.draftData,
      })
      expect(live.status).toBe(200)
      const expected = (await fromGet.json()) as { entry: { locale: string } }
      expect(expected.entry.locale).toBe('en')
      expect(await live.json()).toEqual(expected)

      const edited = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        locale: 'en',
        data: {
          ...row.draftData,
          $i18n: { en: { title: 'Unsaved English', body: sampleRichText } },
        },
      })
      const json = (await edited.json()) as {
        entry: { locale: string; data: { title: string } }
      }
      expect(json.entry.locale).toBe('en')
      expect(json.entry.data.title).toBe('Unsaved English')
    } finally {
      await f.cleanup()
    }
  })

  it('previews a section (global) with unsaved values, and writes nothing', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const section = await createTestGlobal(f.ctx.site.id, {
        key: 'companyInfo',
      })
      await updateDraft(
        section.entry.id,
        { email: 'saved@example.test' },
        f.ctx.actor.id,
        section.entry.draftVersion,
      )
      const before = await rowOf(section.entry.id)
      const token = signPreviewToken({
        siteId: f.ctx.site.id,
        global: 'companyInfo',
        secret: f.ctx.previewSecret,
      })
      const fromGet = await getPreviewFor(token)
      expect(fromGet.status).toBe(200)

      const saved = await post({
        siteId: f.ctx.site.id,
        global: 'companyInfo',
        data: before.draftData,
      })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual(await fromGet.json())

      const live = await post({
        siteId: f.ctx.site.id,
        global: 'companyInfo',
        data: { ...before.draftData, email: 'unsaved@example.test' },
      })
      expect(live.status).toBe(200)
      const json = (await live.json()) as {
        kind: string
        global: string
        entry: { data: { email: string } }
      }
      expect(json.kind).toBe('global')
      expect(json.global).toBe('companyInfo')
      expect(json.entry.data.email).toBe('unsaved@example.test')
      expect(await rowOf(section.entry.id)).toEqual(before)
    } finally {
      await f.cleanup()
    }
  })

  it('refuses without a session (401)', async () => {
    const f = await fixture()
    try {
      setCurrentSession(null)
      const res = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { title: 'x' },
      })
      expect(res.status).toBe(401)
    } finally {
      await f.cleanup()
    }
  })

  it('answers 404 with the same body for another tenant, a missing entry and a wrong site', async () => {
    const f = await fixture()
    const other = await fixture()
    try {
      setCurrentSession(other.owner)
      const foreign = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { title: 'x' },
      })
      const missing = await post({
        siteId: f.ctx.site.id,
        entryId: crypto.randomUUID(),
        collection: 'articles',
        data: { title: 'x' },
      })
      setCurrentSession(f.owner)
      const wrongSite = await post({
        siteId: other.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { title: 'x' },
      })
      const wrongCollection = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'elsewhere',
        data: { title: 'x' },
      })

      for (const res of [foreign, missing, wrongSite, wrongCollection]) {
        expect(res.status).toBe(404)
      }
      const body = await foreign.text()
      expect(await missing.text()).toBe(body)
      expect(await wrongSite.text()).toBe(body)
      expect(body).not.toContain(f.slug)
    } finally {
      await other.cleanup()
      await f.cleanup()
    }
  })

  it('refuses a global section of another tenant with 404', async () => {
    const f = await fixture()
    const other = await fixture()
    try {
      await createTestGlobal(f.ctx.site.id, { key: 'companyInfo' })
      setCurrentSession(other.owner)
      const res = await post({
        siteId: f.ctx.site.id,
        global: 'companyInfo',
        data: { email: 'x@example.test' },
      })
      expect(res.status).toBe(404)
    } finally {
      await other.cleanup()
      await f.cleanup()
    }
  })

  it('lets an editor of the site preview, which is the same right as saving a draft', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.editor)
      const res = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { title: 'Editor edit' },
      })
      expect(res.status).toBe(200)
    } finally {
      await f.cleanup()
    }
  })

  it('answers 400 for an invalid body', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const bodies: unknown[] = [
        { entryId: f.entryId, collection: 'articles', data: {} },
        { siteId: f.ctx.site.id, data: {} },
        {
          siteId: f.ctx.site.id,
          entryId: f.entryId,
          global: 'companyInfo',
          data: {},
        },
        {
          siteId: f.ctx.site.id,
          entryId: f.entryId,
          collection: 'articles',
          data: ['not', 'an', 'object'],
        },
        {
          siteId: f.ctx.site.id,
          entryId: f.entryId,
          collection: 'articles',
          data: { title: 'x' },
          locale: 'not a locale!!',
        },
      ]
      for (const body of bodies) {
        expect((await post(body)).status, JSON.stringify(body)).toBe(400)
      }
      const notJson = await postLivePreview(
        new Request('http://cms.test/api/editor/live-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{nope',
        }),
      )
      expect(notJson.status).toBe(400)
    } finally {
      await f.cleanup()
    }
  })

  it('answers 413 for a body over the draft size limit', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const res = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { title: 'x'.repeat(1_200_000) },
      })
      expect(res.status).toBe(413)
    } finally {
      await f.cleanup()
    }
  })

  it('answers 400 instead of throwing when the client goes away mid-body', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      // What Node gives the handler when the editor aborts the request (a newer
      // value, or the page closing) before the body is read: the stream errors.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"siteId":'))
          controller.error(new Error('aborted'))
        },
      })
      const res = await postLivePreview(
        new Request('http://cms.test/api/editor/live-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          duplex: 'half',
        } as RequestInit),
      )
      expect(res.status).toBe(400)
    } finally {
      await f.cleanup()
    }
  })

  it('answers 400 when the unsaved data breaks the entry rules (same as a save)', async () => {
    const f = await fixture()
    try {
      setCurrentSession(f.owner)
      const res = await post({
        siteId: f.ctx.site.id,
        entryId: f.entryId,
        collection: 'articles',
        data: { notAField: 'x' },
      })
      expect(res.status).toBe(400)
    } finally {
      await f.cleanup()
    }
  })
})
