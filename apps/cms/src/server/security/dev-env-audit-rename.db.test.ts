import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { auditLog, site } from '#/db/schema'
import { audit } from '#/server/audit'
import { changeSiteSlug, createSite, deleteSite } from '#/server/admin/sites'
import { listAuditLog } from '#/server/admin/audit'
import { deleteDevEnvironment } from '#/server/dev-env/delete'
import { forkDevEnvironment } from '#/server/dev-env/fork'
import { createEntry } from '#/server/content/entries'
import {
  createTestCollection,
  sampleRichText,
} from '#/server/content/test-utils'
import { getHomeActivityFn } from '#/server/fn/home'
import { listAuditLogFn } from '#/server/fn/admin'

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

const suffix = () => crypto.randomUUID().slice(0, 8)

/** Creates a production site in the organization and forks its dev env. */
async function productionWithDev(world: World, actorId: string) {
  const prodSlug = `dev-audit-${suffix()}`
  const prod = await createSite({
    organizationId: world.X.org.id,
    name: `Audit prod ${prodSlug}`,
    slug: prodSlug,
    productionUrl: 'https://audit.example.com',
    actorId,
  })
  const fork = await forkDevEnvironment({ id: actorId }, prod.id)
  return { prod, devId: fork.id, devSlug: fork.slug }
}

async function siteSlug(siteId: string) {
  const row = (
    await db
      .select({ slug: site.slug })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  return row?.slug
}

describe.skipIf(!runnable)(
  'development environment audit rows, rename and slug races',
  () => {
    let world: World

    beforeAll(async () => {
      world = await seedWorld()
    })

    afterAll(async () => {
      setCurrentSession(null)
      await world.destroy()
    })

    describe('audit rows for a development environment (Decision 22, #6)', () => {
      it('flags dev-site rows and dev_env actions as agency-only, and nothing else', async () => {
        const actorId = world.users.adminMfa.id
        const { prod, devId } = await productionWithDev(world, actorId)
        try {
          await audit({
            organizationId: world.X.org.id,
            siteId: devId,
            actorId,
            action: 'authz.dev.flag-check',
            targetType: 'site',
            targetId: devId,
          })
          await audit({
            organizationId: world.X.org.id,
            siteId: prod.id,
            actorId,
            action: 'authz.prod.flag-check',
            targetType: 'site',
            targetId: prod.id,
          })

          const rows = await db
            .select({
              action: auditLog.action,
              siteId: auditLog.siteId,
              agencyOnly: auditLog.agencyOnly,
            })
            .from(auditLog)
            .where(eq(auditLog.targetType, 'site'))
          const flagged = rows.filter((row) => row.action.startsWith('authz.'))
          expect(flagged).toContainEqual({
            action: 'authz.dev.flag-check',
            siteId: devId,
            agencyOnly: true,
          })
          expect(flagged).toContainEqual({
            action: 'authz.prod.flag-check',
            siteId: prod.id,
            agencyOnly: false,
          })
          // The fork is a dev_env action on the production site: agency-only.
          expect(
            rows.find(
              (row) => row.action === 'dev_env.fork' && row.siteId === prod.id,
            )?.agencyOnly,
          ).toBe(true)
        } finally {
          await deleteSite(prod.id, actorId)
        }
      })

      it('keeps a deleted dev env’s activity from clients, and shows it to agency admins', async () => {
        const actorId = world.users.adminMfa.id
        const { prod, devId } = await productionWithDev(world, actorId)
        try {
          await createTestCollection(devId)
          const created = await createEntry({
            siteId: devId,
            collectionKey: 'articles',
            data: {
              title: 'Dev only draft',
              slug: `dev-only-${suffix()}`,
              body: sampleRichText,
            },
            actorId,
          })
          // A control row on the production site that a client may see.
          await audit({
            organizationId: world.X.org.id,
            siteId: prod.id,
            actorId,
            action: 'authz.control',
            targetType: 'site',
            targetId: prod.id,
          })

          await deleteDevEnvironment({ id: actorId }, devId)

          // The dev site row is gone, so audit_log.site_id is null now. The
          // stored flag still hides the row.
          const [stored] = await db
            .select({
              siteId: auditLog.siteId,
              agencyOnly: auditLog.agencyOnly,
            })
            .from(auditLog)
            .where(eq(auditLog.targetId, created.id))
            .limit(1)
          expect(stored).toEqual({ siteId: null, agencyOnly: true })

          const clientLog = await runAs(
            listAuditLogFn,
            { organizationId: world.X.org.id, limit: 100, offset: 0 },
            world.sessions.ownerX,
          )
          const clientIds = (clientLog.result as { targetId: string }[]).map(
            (row) => row.targetId,
          )
          expect(clientIds).toContain(prod.id)
          expect(clientIds).not.toContain(created.id)
          expect(clientIds).not.toContain(devId)

          const home = await runAs(
            getHomeActivityFn,
            undefined,
            world.sessions.ownerX,
          )
          const homeIds = (
            home.result as { activity: { targetId: string }[] }
          ).activity.map((row) => row.targetId)
          expect(homeIds).not.toContain(created.id)

          const adminRows = await listAuditLog({
            organizationId: world.X.org.id,
            limit: 200,
            offset: 0,
            includeDevEnvs: true,
          })
          expect(adminRows.map((row) => row.targetId)).toContain(created.id)
        } finally {
          await deleteSite(prod.id, actorId)
        }
      })
    })

    describe('changeSiteSlug and the dev env (#8, #12)', () => {
      it('keeps the dev slug out of the production site.update row and writes dev_env.rename instead', async () => {
        const actorId = world.users.adminMfa.id
        const { prod, devId, devSlug } = await productionWithDev(world, actorId)
        try {
          const newSlug = `renamed-${suffix()}`
          await changeSiteSlug(prod.id, newSlug, actorId)
          expect(await siteSlug(devId)).toBe(`${newSlug}-dev`)
          expect(devSlug).toBe(`${prod.slug}-dev`)

          const updates = await db
            .select({ meta: auditLog.meta })
            .from(auditLog)
            .where(eq(auditLog.action, 'site.update'))
          const slugUpdate = updates
            .map((row) => row.meta)
            .find((meta) => meta?.slug === newSlug)
          expect(slugUpdate).toBeDefined()
          expect(slugUpdate).not.toHaveProperty('devSlug')

          const [rename] = await db
            .select({
              targetId: auditLog.targetId,
              agencyOnly: auditLog.agencyOnly,
              meta: auditLog.meta,
            })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.action, 'dev_env.rename'),
                eq(auditLog.targetId, devId),
              ),
            )
          expect(rename).toMatchObject({
            targetId: devId,
            agencyOnly: true,
            meta: { previousSlug: devSlug, slug: `${newSlug}-dev` },
          })

          const clientLog = await runAs(
            listAuditLogFn,
            { organizationId: world.X.org.id, limit: 100, offset: 0 },
            world.sessions.ownerX,
          )
          expect(
            (clientLog.result as { action: string }[]).map((row) => row.action),
          ).not.toContain('dev_env.rename')
        } finally {
          await deleteSite(prod.id, actorId)
        }
      })

      it('renames the dev env when the fork came first, in sequence', async () => {
        const actorId = world.users.adminMfa.id
        const { prod, devId } = await productionWithDev(world, actorId)
        try {
          const newSlug = `after-fork-${suffix()}`
          await changeSiteSlug(prod.id, newSlug, actorId)
          expect(await siteSlug(devId)).toBe(`${newSlug}-dev`)
        } finally {
          await deleteSite(prod.id, actorId)
        }
      })

      it('never leaves a dev env on an old production slug when a rename races a fork', async () => {
        const actorId = world.users.adminMfa.id
        for (let attempt = 0; attempt < 4; attempt++) {
          const prodSlug = `race-${suffix()}`
          const prod = await createSite({
            organizationId: world.X.org.id,
            name: `Race ${prodSlug}`,
            slug: prodSlug,
            productionUrl: 'https://race.example.com',
            actorId,
          })
          try {
            const newSlug = `race-new-${suffix()}`
            const [renamed, forked] = await Promise.allSettled([
              changeSiteSlug(prod.id, newSlug, actorId),
              forkDevEnvironment({ id: actorId }, prod.id),
            ])
            expect(renamed.status).toBe('fulfilled')
            const devs = await db
              .select({ id: site.id, slug: site.slug })
              .from(site)
              .where(eq(site.parentSiteId, prod.id))
            if (forked.status === 'fulfilled') {
              expect(devs).toHaveLength(1)
            }
            // Whichever won the lock, a dev env follows the final production slug.
            expect(await siteSlug(prod.id)).toBe(newSlug)
            for (const dev of devs) {
              expect(dev.slug).toBe(`${newSlug}-dev`)
            }
          } finally {
            await deleteSite(prod.id, actorId)
          }
        }
      })
    })
  },
)

/** Runs a server function as the transport would, as the given session. */
function runAs(fn: unknown, data: unknown, session: TestSession) {
  if (!isServerFn(fn)) throw new Error('expected a server function')
  return callServerFn(fn, data, session)
}
