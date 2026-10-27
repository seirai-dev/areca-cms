import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { asset, site } from '#/db/schema'
import { NotFoundError, ValidationError } from '#/server/content/errors'
import { getAssetFn, listAssetsFn, updateAssetFn } from '#/server/fn/assets'
import { generateEntrySeoFn } from '#/server/fn/ai'
import { translateContentFn } from '#/server/fn/translate'

import { setCurrentSession } from './authz-state'
import type { TestSession } from './authz-state'
import { callServerFn, isServerFn, seedWorld } from './authz-harness'
import type { World } from './authz-harness'

// Must run before `#/env` is first imported: guards read ADMIN_MFA_REQUIRED.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

vi.mock('#/lib/auth', async () => (await import('./authz-state')).fakeAuth())
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('./authz-start-patch')).patchStart(await importOriginal()),
)

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Same rule as the other authorization suites: never run against a developer database.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

function runAs(fn: unknown, data: unknown, session: TestSession) {
  if (!isServerFn(fn)) throw new Error('expected a server function')
  return callServerFn(fn, data, session)
}

/** The error a refused call gives, or null when it succeeded. */
async function errorOf(
  fn: unknown,
  data: unknown,
  session: TestSession,
): Promise<unknown> {
  const outcome = await runAs(fn, data, session)
  return outcome.error ?? null
}

describe.skipIf(!runnable)('probes that must not reveal a hidden site', () => {
  let world: World
  let devId: string
  let assetId: string

  beforeAll(async () => {
    world = await seedWorld()
    const dev = (
      await db
        .insert(site)
        .values({
          organizationId: world.X.org.id,
          name: 'Probe dev (dev)',
          slug: `probe-${crypto.randomUUID().slice(0, 8)}-dev`,
          tokenHash: `h-${crypto.randomUUID()}`,
          schemaTokenHash: `s-${crypto.randomUUID()}`,
          productionUrl: 'http://localhost:3000',
          previewSecret: crypto.randomUUID(),
          publishingMode: 'demo',
          deploymentTarget: null,
          environment: 'development',
          parentSiteId: world.X.site.id,
        })
        .returning()
    ).at(0)
    if (!dev) throw new Error('dev insert failed')
    devId = dev.id
    // An image uploaded from the dev env into the shared library.
    const row = (
      await db
        .insert(asset)
        .values({
          organizationId: world.X.org.id,
          storageKey: `probe/${crypto.randomUUID()}.png`,
          originalFilename: 'dev.png',
          mimeType: 'image/png',
          size: 10,
          altText: 'dev upload',
          originSiteId: devId,
        })
        .returning()
    ).at(0)
    if (!row) throw new Error('asset insert failed')
    assetId = row.id
  })

  afterAll(async () => {
    setCurrentSession(null)
    await db.delete(site).where(eq(site.id, devId))
    await world.destroy()
  })

  describe('asset origin (#17)', () => {
    it('keeps originSiteId from clients in the library list, the single asset and the alt update', async () => {
      const client = await runAs(
        listAssetsFn,
        { organizationId: world.X.org.id, limit: 100, offset: 0 },
        world.sessions.ownerX,
      )
      const clientRow = (
        client.result as { id: string; originSiteId: string | null }[]
      ).find((row) => row.id === assetId)
      expect(clientRow?.originSiteId).toBeNull()

      const clientOne = await runAs(
        getAssetFn,
        { id: assetId },
        world.sessions.ownerX,
      )
      expect(
        (clientOne.result as { originSiteId: string | null } | null)
          ?.originSiteId,
      ).toBeNull()

      const clientUpdate = await runAs(
        updateAssetFn,
        { id: assetId, altText: 'still dev upload' },
        world.sessions.ownerX,
      )
      expect(
        (clientUpdate.result as { originSiteId: string | null } | undefined)
          ?.originSiteId,
      ).toBeNull()
    })

    it('still gives agency admins the origin site', async () => {
      const admin = await runAs(
        listAssetsFn,
        { organizationId: world.X.org.id, limit: 100, offset: 0 },
        world.sessions.adminMfa,
      )
      const adminRow = (
        admin.result as { id: string; originSiteId: string | null }[]
      ).find((row) => row.id === assetId)
      expect(adminRow?.originSiteId).toBe(devId)

      const adminOne = await runAs(
        getAssetFn,
        { id: assetId },
        world.sessions.adminMfa,
      )
      expect(
        (adminOne.result as { originSiteId: string | null } | null)
          ?.originSiteId,
      ).toBe(devId)
    })
  })

  describe('AI and translation probes (#18)', () => {
    let languagesBefore: typeof site.$inferSelect.languages = null

    beforeAll(async () => {
      const row = (
        await db
          .select({ languages: site.languages })
          .from(site)
          .where(eq(site.id, world.X.site.id))
          .limit(1)
      ).at(0)
      languagesBefore = row?.languages ?? null
      await db
        .update(site)
        .set({ languages: { main: 'en', all: ['en', 'nl'] } })
        .where(eq(site.id, world.X.site.id))
    })

    afterAll(async () => {
      await db
        .update(site)
        .set({ languages: languagesBefore })
        .where(eq(site.id, world.X.site.id))
    })

    const seoInput = (siteId: string, locale: string) => ({
      siteId,
      collectionKey: 'articles',
      data: {},
      locale,
    })

    it('answers a non-member the same NotFound for an unknown language as for a known one', async () => {
      const unknownLanguage = await errorOf(
        generateEntrySeoFn,
        seoInput(world.X.site.id, 'fr'),
        world.sessions.ownerY,
      )
      const knownLanguage = await errorOf(
        generateEntrySeoFn,
        seoInput(world.X.site.id, 'nl'),
        world.sessions.ownerY,
      )
      const missingSite = await errorOf(
        generateEntrySeoFn,
        seoInput(crypto.randomUUID(), 'fr'),
        world.sessions.ownerY,
      )
      expect(unknownLanguage).toBeInstanceOf(NotFoundError)
      expect(knownLanguage).toBeInstanceOf(NotFoundError)
      expect(missingSite).toBeInstanceOf(NotFoundError)
    })

    it('still checks the language for a member of the site', async () => {
      const error = await errorOf(
        generateEntrySeoFn,
        seoInput(world.X.site.id, 'fr'),
        world.sessions.ownerX,
      )
      expect(error).toBeInstanceOf(ValidationError)
    })

    it('translation answers a non-member NotFound before any language check', async () => {
      const error = await errorOf(
        translateContentFn,
        {
          siteId: world.X.site.id,
          entryId: crypto.randomUUID(),
          to: 'fr',
        },
        world.sessions.ownerY,
      )
      expect(error).toBeInstanceOf(NotFoundError)
    })
  })
})
