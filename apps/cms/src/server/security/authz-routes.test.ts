/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { collection } from '#/db/schema'
import { Route as brandingUploadRoute } from '#/routes/api/admin/branding/upload'
import { Route as assetUploadRoute } from '#/routes/api/assets/upload'
import {
  getSitesManifest,
  postSitesManifest,
} from '#/routes/api/sites/manifest'
import { getSitesPreview } from '#/routes/api/sites/preview'
import { getSitesSnapshotCurrent } from '#/routes/api/sites/snapshot/current'
import { signPreviewToken } from '#/server/content/preview-token'
import { handleMetricsRequest } from '#/server/ops/metrics'

import { ACTORS, seedWorld } from './authz-harness'
import type { ActorName, World } from './authz-harness'
import { setCurrentSession } from './authz-state'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})
vi.mock('#/lib/auth', async () => (await import('./authz-state')).fakeAuth())
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

/**
 * Every file under src/routes/api and who may call it. A new route without an
 * entry here fails the inventory test below.
 */
const ROUTE_INVENTORY: Record<string, string> = {
  '/src/routes/api/admin/branding/upload.ts':
    'POST agency admin + MFA (cookie session)',
  '/src/routes/api/assets/upload.ts':
    'POST org member of the target organization (cookie session)',
  '/src/routes/api/assets/file/$prefix/$filename.ts':
    'GET public by design (public asset delivery); OPTIONS CORS',
  '/src/routes/api/auth/$.ts':
    'Better Auth handler (own endpoint-level auth; out of scope here)',
  '/src/routes/api/health.ts': 'GET public liveness',
  '/src/routes/api/health.ready.ts': 'GET public readiness',
  '/src/routes/api/metrics.ts': 'GET bearer METRICS_TOKEN; 404 when unset',
  '/src/routes/api/notifications.unsubscribe.ts':
    'POST public one-click unsubscribe; the signed token in the query is the authorization (no cookie)',
  '/src/routes/api/mcp/index.ts':
    'POST/GET/DELETE personal MCP key on /api/mcp (bearer only, re-authenticated each request)',
  '/src/routes/api/mcp/$siteSlug.ts':
    'POST/GET/DELETE per-site MCP: OAuth access token or personal key for that site (bearer only)',
  '/src/routes/api/sites/manifest.ts':
    'GET site build token; POST site schema token',
  '/src/routes/api/sites/preview.ts': 'GET HMAC-signed, expiring preview token',
  '/src/routes/api/sites/snapshot/current.ts': 'GET site build token',
}

type Handler = (ctx: { request: Request }) => Promise<Response>
const handlerOf = (route: unknown, method: 'POST' | 'GET') =>
  (route as { options: { server: { handlers: Record<string, Handler> } } })
    .options.server.handlers[method]

function multipart(fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') form.set(key, value)
    else form.set(key, value, 'upload.txt')
  }
  return new Request('http://cms.test/api/upload', {
    method: 'POST',
    body: form,
  })
}

const bearer = (token?: string, scheme = 'Bearer') =>
  new Request('http://cms.test/api/sites/x', {
    headers: token === undefined ? {} : { Authorization: `${scheme} ${token}` },
  })
const bearerPost = (token: string | undefined, body: unknown) =>
  new Request('http://cms.test/api/sites/manifest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })

describe('route inventory', () => {
  it('lists every API route file', () => {
    const files = Object.keys(
      import.meta.glob([
        '/src/routes/api/**/*.ts',
        '!/src/routes/api/**/*.test.ts',
      ]),
    ).sort()
    expect(files).toEqual(Object.keys(ROUTE_INVENTORY).sort())
  })
})

describe.skipIf(!runnable)('API routes: session-authenticated uploads', () => {
  let w: World
  beforeAll(async () => {
    w = await seedWorld()
  }, 60_000)
  afterAll(async () => {
    await w?.destroy()
  })

  const text = () => new Blob(['not an image'], { type: 'text/plain' })

  // 400 = the guard let the caller through and the (deliberately invalid
  // text/plain) file was refused by validation, so nothing reaches storage.
  const assetExpectations: Record<ActorName, number> = {
    anonymous: 401,
    editorX: 400,
    ownerX: 400,
    ownerY: 403,
    adminNoMfa: 403,
    adminMfa: 400,
    adminStale: 400,
  }
  for (const actor of ACTORS) {
    it(`POST /api/assets/upload for org X as ${actor} -> ${assetExpectations[actor]}`, async () => {
      setCurrentSession(w.sessions[actor])
      const res = await handlerOf(
        assetUploadRoute,
        'POST',
      )({
        request: multipart({ file: text(), organizationId: w.X.org.id }),
      })
      expect(res.status).toBe(assetExpectations[actor])
      if (actor === 'adminNoMfa') expect(await res.text()).toBe('MFA_REQUIRED')
    })
  }

  it('upload as org Y owner works for Y but never for X (no cross-tenant write)', async () => {
    setCurrentSession(w.sessions.ownerY)
    const own = await handlerOf(
      assetUploadRoute,
      'POST',
    )({
      request: multipart({ file: text(), organizationId: w.Y.org.id }),
    })
    expect(own.status).toBe(400)
    const other = await handlerOf(
      assetUploadRoute,
      'POST',
    )({
      request: multipart({ file: text(), organizationId: w.X.org.id }),
    })
    expect(other.status).toBe(403)
  })

  it('refuses an unauthenticated upload before parsing the body', async () => {
    setCurrentSession(null)
    const res = await handlerOf(
      assetUploadRoute,
      'POST',
    )({
      request: new Request('http://cms.test/api/assets/upload', {
        method: 'POST',
        headers: { 'content-length': String(500 * 1024 * 1024) },
        body: 'x',
      }),
    })
    expect(res.status).toBe(401)
  })

  const brandingExpectations: Record<ActorName, number> = {
    anonymous: 401,
    editorX: 403,
    ownerX: 403,
    ownerY: 403,
    adminNoMfa: 403,
    adminMfa: 400,
    adminStale: 400,
  }
  for (const actor of ACTORS) {
    it(`POST /api/admin/branding/upload as ${actor} -> ${brandingExpectations[actor]}`, async () => {
      setCurrentSession(w.sessions[actor])
      // Invalid `kind` => 400 for callers that passed the guard, no write.
      const res = await handlerOf(
        brandingUploadRoute,
        'POST',
      )({
        request: multipart({ file: text(), kind: 'nope' }),
      })
      expect(res.status).toBe(brandingExpectations[actor])
      if (actor === 'adminNoMfa') expect(await res.text()).toBe('MFA_REQUIRED')
    })
  }
})

describe.skipIf(!runnable)('API routes: site token authentication', () => {
  let w: World
  beforeAll(async () => {
    w = await seedWorld()
  }, 60_000)
  afterAll(async () => {
    await w?.destroy()
  })

  const garbage: Array<[string, Request]> = [
    ['no Authorization header', bearer(undefined)],
    ['empty bearer', bearer('')],
    ['random bearer', bearer('0'.repeat(64))],
    ['Basic scheme', bearer('anything', 'Basic')],
    ['lowercase scheme', bearer('anything', 'bearer')],
  ]

  describe('GET /api/sites/manifest (build token)', () => {
    for (const [label, req] of garbage) {
      it(`rejects ${label}`, async () => {
        const res = await getSitesManifest(req)
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'Unauthorized' })
      })
    }

    it("returns only the token's own site schema", async () => {
      const res = await getSitesManifest(bearer(w.X.token))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const body = (await res.json()) as {
        collections: Record<string, unknown>
      }
      expect(Object.keys(body.collections)).toEqual(['articles'])
      // Make Y distinguishable, then check X's token cannot see it.
      await db
        .update(collection)
        .set({ label: 'Y-ONLY-LABEL' })
        .where(eq(collection.id, w.Y.collection.id))
      const again = await getSitesManifest(bearer(w.X.token))
      expect(JSON.stringify(await again.json())).not.toContain('Y-ONLY-LABEL')
      const forY = await getSitesManifest(bearer(w.Y.token))
      expect(JSON.stringify(await forY.json())).toContain('Y-ONLY-LABEL')
    })

    it('does not accept the schema token as a read token', async () => {
      expect((await getSitesManifest(bearer(w.X.schemaToken))).status).toBe(401)
    })
  })

  describe('POST /api/sites/manifest (schema token)', () => {
    const body = (key: string) => ({
      collections: {
        [key]: {
          route: `/${key}/$slug`,
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      },
    })

    for (const [label] of garbage) {
      it(`rejects ${label}`, async () => {
        const res = await postSitesManifest(
          bearerPost(
            label === 'no Authorization header' ? undefined : 'nope',
            body('evil'),
          ),
        )
        expect(res.status).toBe(401)
      })
    }

    it('rejects the read/build token for a schema write', async () => {
      const res = await postSitesManifest(
        bearerPost(w.X.token, body('fromBuildToken')),
      )
      expect(res.status).toBe(401)
      const rows = await db
        .select()
        .from(collection)
        .where(eq(collection.siteId, w.X.site.id))
      expect(rows.map((r) => r.key)).not.toContain('fromBuildToken')
    })

    it('a schema token only ever writes its own site (X token never touches Y)', async () => {
      const res = await postSitesManifest(
        bearerPost(w.X.schemaToken, body('xonly')),
      )
      expect(res.status).toBe(200)
      const xKeys = (
        await db
          .select()
          .from(collection)
          .where(eq(collection.siteId, w.X.site.id))
      ).map((r) => r.key)
      const yKeys = (
        await db
          .select()
          .from(collection)
          .where(eq(collection.siteId, w.Y.site.id))
      ).map((r) => r.key)
      expect(xKeys).toContain('xonly')
      expect(yKeys).not.toContain('xonly')
    })

    it('a rotated/old token stops working', async () => {
      const { rotateSiteTokenAdmin } = await import('#/server/admin/sites')
      const s = await w.fresh.site('X')
      // Use the real rotation; the previous hash is gone.
      const rotated = await rotateSiteTokenAdmin(
        s.id,
        'schema',
        w.users.adminMfa.id,
      )
      const fresh = rotated.token
      expect(
        (await postSitesManifest(bearerPost(fresh, body('afterrotate'))))
          .status,
      ).toBe(200)
      const rotatedAgain = await rotateSiteTokenAdmin(
        s.id,
        'schema',
        w.users.adminMfa.id,
      )
      expect(
        (await postSitesManifest(bearerPost(fresh, body('stale')))).status,
      ).toBe(401)
      expect(rotatedAgain.token).not.toBe(fresh)
    })
  })

  describe('GET /api/sites/snapshot/current (build token)', () => {
    for (const [label, req] of garbage) {
      it(`rejects ${label}`, async () => {
        expect((await getSitesSnapshotCurrent(req)).status).toBe(401)
      })
    }

    it('rejects the schema token', async () => {
      expect(
        (await getSitesSnapshotCurrent(bearer(w.X.schemaToken))).status,
      ).toBe(401)
    })

    it('serves each site only its own publication', async () => {
      const x = await getSitesSnapshotCurrent(bearer(w.X.token))
      const y = await getSitesSnapshotCurrent(bearer(w.Y.token))
      expect(x.status).toBe(200)
      expect(y.status).toBe(200)
      const xText = JSON.stringify(await x.json())
      const yText = JSON.stringify(await y.json())
      expect(xText).toContain(w.X.marker)
      expect(xText).not.toContain(w.Y.marker)
      expect(yText).toContain(w.Y.marker)
      expect(yText).not.toContain(w.X.marker)
      expect(x.headers.get('Cache-Control')).toBe('no-store')
    })
  })

  describe('GET /api/sites/preview (signed token)', () => {
    const req = (token: string) =>
      new Request(
        `http://cms.test/api/sites/preview?token=${encodeURIComponent(token)}`,
      )
    const sign = (
      side: 'X' | 'Y',
      over: Partial<Parameters<typeof signPreviewToken>[0]> = {},
    ) =>
      signPreviewToken({
        siteId: w[side].site.id,
        collection: 'articles',
        slug: w[side].entry.slug,
        secret: w[side].previewSecret,
        ...over,
      })

    it('serves the draft for a valid token, scoped to its site', async () => {
      const res = await getSitesPreview(req(sign('X')))
      expect(res.status).toBe(200)
      const text = JSON.stringify(await res.json())
      expect(text).toContain(w.X.entry.slug)
      expect(text).not.toContain(w.Y.entry.slug)
    })

    it("cannot read another site's draft through a valid token for its own site", async () => {
      const res = await getSitesPreview(
        req(sign('X', { slug: w.Y.entry.slug })),
      )
      expect(res.status).toBe(404)
      expect(JSON.stringify(await res.json())).not.toContain('Entry ')
    })

    it('rejects an expired token', async () => {
      expect(
        (await getSitesPreview(req(sign('X', { ttlSec: -5 })))).status,
      ).toBe(401)
    })

    it("rejects a token signed with another site's secret", async () => {
      expect(
        (await getSitesPreview(req(sign('X', { secret: w.Y.previewSecret }))))
          .status,
      ).toBe(401)
    })

    it('rejects a token re-pointed at another site (payload tampered, signature kept)', async () => {
      const [payload, sig] = sign('X').split('.')
      const parsed = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      )
      parsed.siteId = w.Y.site.id
      parsed.slug = w.Y.entry.slug
      const forged = `${Buffer.from(JSON.stringify(parsed)).toString('base64url')}.${sig}`
      expect((await getSitesPreview(req(forged))).status).toBe(401)
    })

    it('rejects a lengthened expiry (payload tampered, signature kept)', async () => {
      const [payload, sig] = sign('X', { ttlSec: -5 }).split('.')
      const parsed = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      )
      parsed.exp = Math.floor(Date.now() / 1000) + 86_400
      const forged = `${Buffer.from(JSON.stringify(parsed)).toString('base64url')}.${sig}`
      expect((await getSitesPreview(req(forged))).status).toBe(401)
    })

    it('rejects structurally broken tokens and unknown sites', async () => {
      const unknownSite = signPreviewToken({
        siteId: crypto.randomUUID(),
        collection: 'articles',
        slug: 'x',
        secret: 'whatever',
      })
      for (const token of [
        '',
        'abc',
        'abc.',
        '.abc',
        'a.b.c',
        `${sign('X').split('.')[0]}.`,
        unknownSite,
      ]) {
        expect((await getSitesPreview(req(token))).status, token).toBe(401)
      }
      expect(
        (
          await getSitesPreview(
            new Request('http://cms.test/api/sites/preview'),
          )
        ).status,
      ).toBe(401)
    })
  })
})

describe('API routes: operational endpoints', () => {
  const metricsReq = (token?: string) =>
    new Request('http://cms.test/api/metrics', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  const collect = async () => ({}) as never

  it('metrics are hidden entirely when no token is configured', async () => {
    const res = await handleMetricsRequest(metricsReq('anything'), {
      token: undefined,
      collect,
    })
    expect(res.status).toBe(404)
  })

  it('metrics require the configured bearer token', async () => {
    const deps = { token: 'a-long-enough-metrics-token', collect }
    expect((await handleMetricsRequest(metricsReq(), deps)).status).toBe(401)
    expect(
      (
        await handleMetricsRequest(
          metricsReq('wrong-token-wrong-token!!'),
          deps,
        )
      ).status,
    ).toBe(401)
    // Authenticated: past the gate (the empty stub collector may still 503).
    const ok = (
      await handleMetricsRequest(
        metricsReq('a-long-enough-metrics-token'),
        deps,
      )
    ).status
    expect([401, 404]).not.toContain(ok)
  })
})
