import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { auditLog, publication, site } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { updateSite } from '#/server/admin/sites'
import { ConflictError } from '#/server/content/errors'
import { updateSiteFn } from '#/server/fn/admin'
import { deleteAssetFn, updateAssetFn } from '#/server/fn/assets'
import {
  callServerFn,
  isServerFn,
  seedWorld,
} from '#/server/security/authz-harness'
import type { World } from '#/server/security/authz-harness'
import { setCurrentSession } from '#/server/security/authz-state'
import type { TestSession } from '#/server/security/authz-state'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

vi.mock('#/lib/auth', async () =>
  (await import('#/server/security/authz-state')).fakeAuth(),
)
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('#/server/security/authz-start-patch')).patchStart(
    await importOriginal(),
  ),
)

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

const target = {
  provider: 'dokploy' as const,
  applicationId: 'app-mode-rules',
  healthCheckUrl: 'https://mode.example.test/health',
}

function runAs(fn: unknown, data: unknown, session: TestSession) {
  if (!isServerFn(fn)) throw new Error('expected a server function')
  return callServerFn(fn, data, session)
}

async function modeOf(siteId: string) {
  const [row] = await db
    .select({ mode: site.publishingMode })
    .from(site)
    .where(eq(site.id, siteId))
  return row.mode
}

async function goneLive(siteId: string) {
  await db.insert(publication).values({
    siteId,
    snapshot: { schemaVersion: 1 } as never,
    snapshotHash: `live-${crypto.randomUUID()}`,
    status: 'superseded',
    publishingMode: 'production',
    wasLive: true,
  })
}

describe.skipIf(!runnable)('publishing-mode rules and asset audits', () => {
  let world: World
  let admin: NonNullable<TestSession>

  beforeAll(async () => {
    world = await seedWorld()
    admin = world.sessions.adminMfa!
  })

  afterAll(async () => {
    setCurrentSession(null)
    await world.destroy()
  })

  describe('updateSite', () => {
    it('refuses production without a deployment target', async () => {
      const fresh = await world.fresh.site()
      await expect(
        updateSite(fresh.id, { publishingMode: 'production' }, admin.user.id),
      ).rejects.toThrow(m.server_publishing_mode_needs_target())
      expect(await modeOf(fresh.id)).toBe('demo')
    })

    it('switches to production with the target given in the same change', async () => {
      const fresh = await world.fresh.site()
      const updated = await updateSite(
        fresh.id,
        { publishingMode: 'production', deploymentTarget: target },
        admin.user.id,
      )
      expect(updated.publishingMode).toBe('production')
    })

    it('switches a never-live site back to demo', async () => {
      const fresh = await world.fresh.site()
      await updateSite(
        fresh.id,
        { publishingMode: 'production', deploymentTarget: target },
        admin.user.id,
      )
      const updated = await updateSite(
        fresh.id,
        { publishingMode: 'demo' },
        admin.user.id,
      )
      expect(updated.publishingMode).toBe('demo')
    })

    it('refuses demo once the site has gone live', async () => {
      const fresh = await world.fresh.site()
      await updateSite(
        fresh.id,
        { publishingMode: 'production', deploymentTarget: target },
        admin.user.id,
      )
      await goneLive(fresh.id)
      const refused = updateSite(
        fresh.id,
        { publishingMode: 'demo' },
        admin.user.id,
      )
      await expect(refused).rejects.toBeInstanceOf(ConflictError)
      await expect(refused).rejects.toThrow(
        m.server_publishing_mode_demo_after_live(),
      )
      expect(await modeOf(fresh.id)).toBe('production')
    })
  })

  describe('updateSiteFn', () => {
    it('refuses demo after go-live and production without a target', async () => {
      const live = await world.fresh.site()
      await updateSite(
        live.id,
        { publishingMode: 'production', deploymentTarget: target },
        admin.user.id,
      )
      await goneLive(live.id)
      const demo = await runAs(
        updateSiteFn,
        { id: live.id, publishingMode: 'demo' },
        admin,
      )
      expect(demo.error).toBeInstanceOf(ConflictError)
      expect(await modeOf(live.id)).toBe('production')

      const bare = await world.fresh.site()
      const production = await runAs(
        updateSiteFn,
        { id: bare.id, publishingMode: 'production' },
        admin,
      )
      expect(production.error).toBeInstanceOf(ConflictError)
      expect(await modeOf(bare.id)).toBe('demo')
    })
  })

  describe('asset server functions', () => {
    it('audit an alt-text change and a delete once each', async () => {
      const row = await world.fresh.asset()
      const updated = await runAs(
        updateAssetFn,
        { id: row.id, altText: 'New alt', siteId: world.X.site.id },
        admin,
      )
      expect(updated.error).toBeUndefined()
      const deleted = await runAs(deleteAssetFn, { id: row.id }, admin)
      expect(deleted.error).toBeUndefined()

      const events = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.targetId, row.id), eq(auditLog.targetType, 'asset')),
        )
      expect(events.map((event) => event.action).sort()).toEqual([
        'asset.delete',
        'asset.update',
      ])
      const update = events.find((event) => event.action === 'asset.update')
      expect(update).toMatchObject({
        actorId: admin.user.id,
        siteId: world.X.site.id,
        organizationId: row.organizationId,
        meta: { filename: 'pic.png' },
      })
      const removal = events.find((event) => event.action === 'asset.delete')
      expect(removal).toMatchObject({ actorId: admin.user.id, siteId: null })
    })
  })
})
