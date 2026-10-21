import type * as MailConfig from '#/server/mail/config'
import type * as MailTransport from '#/server/mail/transport'
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import {
  asset,
  buildJob,
  collection,
  entry,
  invitation,
  membership,
  site,
} from '#/db/schema'
import { NotFoundError } from '#/server/content/errors'

import { ALL_FN_MODULES, ROWS } from './authz-matrix'
import {
  ACTORS,
  POLICY_EXPECTATIONS,
  callServerFn,
  classify,
  isServerFn,
  outcomeLabel,
  seedWorld,
} from './authz-harness'
import type { ActorName, World } from './authz-harness'
import { sanitizeServerError } from '#/server/http/safe-error'
import { setLogSink } from '#/server/log'
import { setCurrentSession } from './authz-state'

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
vi.mock('#/server/mail/config', async (importOriginal) => ({
  ...(await importOriginal<typeof MailConfig>()),
  resolveMailConfig: async () => ({
    source: 'env' as const,
    host: 'mail.test',
    port: 587,
    secure: 'starttls' as const,
    username: null,
    password: null,
    from: 'cms@areca.test',
    replyTo: null,
  }),
}))
vi.mock('#/server/mail/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof MailTransport>()),
  sendMail: async () => ({ messageId: 'test-message' }),
}))

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Never run against a developer database: only throwaway/isolated names.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

describe.skipIf(!runnable)(
  'authorization matrix: direct server-function calls',
  () => {
    let w: World

    beforeAll(async () => {
      w = await seedWorld()
    }, 60_000)
    afterAll(async () => {
      await w?.destroy()
    })

    it('has a matrix row for every server function (inventory)', () => {
      const inMatrix = new Set(ROWS.map((row) => row.fn))
      const missing: string[] = []
      for (const [moduleName, mod] of Object.entries(ALL_FN_MODULES)) {
        for (const [exportName, value] of Object.entries(mod)) {
          if (isServerFn(value) && !inMatrix.has(value)) {
            missing.push(`${moduleName}.${exportName}`)
          }
        }
      }
      expect(missing).toEqual([])
      // ... and the glob sees no module the matrix does not import.
      const files = Object.keys(
        import.meta.glob('/src/server/fn/*.ts', { eager: false }),
      ).map((path) => path.split('/').pop()!.replace(/\.ts$/, ''))
      expect(files.sort()).toEqual(Object.keys(ALL_FN_MODULES).sort())
    })

    for (const row of ROWS) {
      describe(row.name, () => {
        for (const actor of ACTORS) {
          const expected =
            row.override?.[actor] ??
            (row.hidden && actor === 'ownerY'
              ? 'not-found'
              : POLICY_EXPECTATIONS[row.policy][actor])
          it(`${actor} -> ${expected}`, async () => {
            const prepared = await row.prepare(w)
            const outcome = await callServerFn(
              row.fn as Parameters<typeof callServerFn>[0],
              prepared.data,
              w.sessions[actor],
            )
            const got = outcomeLabel(
              outcome,
              Boolean(row.tolerant) && expected === 'allowed',
            )
            expect(
              got,
              `${row.name} as ${actor}: ${String((outcome.error as Error | undefined)?.message ?? 'ok')}`,
            ).toBe(expected)
            if (expected !== 'allowed') {
              // A refused call must not leak a result nor touch the resource.
              expect(outcome.result).toBeUndefined()
              if (prepared.untouched) {
                expect(
                  await prepared.untouched(),
                  'denied call had a side effect',
                ).toBe(true)
              }
            }
          })
        }
      })
    }
  },
)

describe.skipIf(!runnable)(
  'cross-tenant ID mixing (caller owns one side, targets the other)',
  () => {
    let w: World
    beforeAll(async () => {
      w = await seedWorld()
    }, 60_000)
    afterAll(async () => {
      await w?.destroy()
    })

    const call = (fn: unknown, data: unknown, actor: ActorName) =>
      callServerFn(
        fn as Parameters<typeof callServerFn>[0],
        data,
        w.sessions[actor],
      )

    it('owner of X cannot read/write entries, collections or releases of Y by ID', async () => {
      const { contentFns, publishingFns } = await fns()
      const attempts: Array<[string, unknown, unknown]> = [
        [
          'listEntries',
          contentFns.listEntriesFn,
          { siteId: w.Y.site.id, collectionKey: 'articles' },
        ],
        [
          'listCollections',
          contentFns.listCollectionsFn,
          { siteId: w.Y.site.id },
        ],
        ['getEntry', contentFns.getEntryFn, { id: w.Y.entry.id }],
        [
          'listRevisions',
          contentFns.listRevisionsFn,
          { entryId: w.Y.entry.id },
        ],
        [
          'createEntry',
          contentFns.createEntryFn,
          {
            siteId: w.Y.site.id,
            collectionKey: 'articles',
            data: { title: 'x', slug: 'planted' },
          },
        ],
        [
          'updateDraft',
          contentFns.updateDraftFn,
          {
            id: w.Y.entry.id,
            data: { title: 'pwn' },
            expectedVersion: w.Y.entry.draftVersion,
          },
        ],
        ['publish', contentFns.publishEntryFn, { id: w.Y.entry.id }],
        ['delete', contentFns.deleteEntryFn, { id: w.Y.entry.id }],
        [
          'previewUrl',
          contentFns.getPreviewUrlFn,
          { siteId: w.Y.site.id, collection: 'articles', slug: w.Y.entry.slug },
        ],
        [
          'listPublications',
          publishingFns.listPublicationsFn,
          { siteId: w.Y.site.id },
        ],
        [
          'releaseStatus',
          publishingFns.getSiteReleaseStatusFn,
          { siteId: w.Y.site.id },
        ],
        ['getBuildJob', publishingFns.getBuildJobFn, { id: w.Y.job.id }],
        [
          'reconcileDeployment',
          publishingFns.reconcileDeploymentJobFn,
          { id: w.Y.job.id },
        ],
        [
          'requestPublication',
          publishingFns.requestPublicationFn,
          { siteId: w.Y.site.id, requestKey: crypto.randomUUID() },
        ],
      ]
      for (const [label, fn, data] of attempts) {
        const out = await call(fn, data, 'ownerX')
        expect(classify(out.error), label).toBe('not-found')
        expect(out.result, `${label} leaked data`).toBeUndefined()
      }
      const [row] = await db
        .select()
        .from(entry)
        .where(eq(entry.id, w.Y.entry.id))
      expect(row?.draftVersion).toBe(w.Y.entry.draftVersion)
      expect(row?.status).toBe('draft')
    })

    it('owner of X cannot reach Y assets, members, invitations or audit trail', async () => {
      const { assetFns, adminFns } = await fns()
      const invite = await w.fresh.invitation('Y')
      const memberY = await w.fresh.membership('Y', 'editor')
      const attempts: Array<[string, unknown, unknown]> = [
        [
          'listAssets',
          assetFns.listAssetsFn,
          { organizationId: w.Y.org.id, limit: 10, offset: 0 },
        ],
        ['getAsset', assetFns.getAssetFn, { id: w.Y.asset.id }],
        [
          'updateAsset',
          assetFns.updateAssetFn,
          { id: w.Y.asset.id, altText: 'pwn' },
        ],
        ['deleteAsset', assetFns.deleteAssetFn, { id: w.Y.asset.id }],
        ['listMembers', adminFns.listMembersFn, { organizationId: w.Y.org.id }],
        [
          'removeMember',
          adminFns.removeMemberFn,
          { organizationId: w.Y.org.id, userId: memberY.user.id },
        ],
        [
          'updateMemberRole',
          adminFns.updateMemberRoleFn,
          {
            organizationId: w.Y.org.id,
            userId: memberY.user.id,
            role: 'owner',
          },
        ],
        [
          'invite',
          adminFns.inviteMemberFn,
          {
            organizationId: w.Y.org.id,
            email: 'planted@authz.test',
            role: 'owner',
          },
        ],
        [
          'listInvitations',
          adminFns.listInvitationsFn,
          { organizationId: w.Y.org.id },
        ],
        ['revokeInvitation', adminFns.revokeInvitationFn, { id: invite.id }],
        [
          'auditLog',
          adminFns.listAuditLogFn,
          { organizationId: w.Y.org.id, limit: 10, offset: 0 },
        ],
      ]
      for (const [label, fn, data] of attempts) {
        const out = await call(fn, data, 'ownerX')
        if (label === 'getAsset') {
          expect(out.error).toBeUndefined()
          expect(out.result).toBeNull()
          continue
        }
        expect(classify(out.error), label).toBe(
          ['updateAsset', 'deleteAsset', 'revokeInvitation'].includes(label)
            ? 'not-found'
            : 'forbidden',
        )
        expect(out.result, `${label} leaked data`).toBeUndefined()
      }
      const [a] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, w.Y.asset.id))
      expect(a?.altText).toBe('original alt')
      expect(
        await db.select().from(invitation).where(eq(invitation.id, invite.id)),
      ).toHaveLength(1)
      expect(
        await db
          .select()
          .from(membership)
          .where(eq(membership.id, memberY.membership.id)),
      ).toHaveLength(1)
    })

    it('an organization-scoped audit query cannot be widened to another tenant site', async () => {
      const { adminFns } = await fns()
      const out = await call(
        adminFns.listAuditLogFn,
        {
          organizationId: w.X.org.id,
          siteId: w.Y.site.id,
          limit: 50,
          offset: 0,
        },
        'ownerX',
      )
      expect(out.error).toBeUndefined()
      const rows = out.result as Array<{
        organizationId: string
        siteId: string
      }>
      expect(rows.filter((r) => r.organizationId !== w.X.org.id)).toEqual([])
      expect(rows.filter((r) => r.siteId === w.Y.site.id)).toEqual([])
    })

    it('rollback cannot target another tenant publication through a site the caller owns', async () => {
      const { publishingFns } = await fns()
      const mine = await w.fresh.site('X')
      const before = await db
        .select()
        .from(buildJob)
        .where(eq(buildJob.siteId, mine.id))
      const out = await call(
        publishingFns.requestRollbackFn,
        {
          siteId: mine.id,
          publicationId: w.Y.publication.id,
          requestKey: crypto.randomUUID(),
        },
        'ownerX',
      )
      expect(classify(out.error)).toBe('not-found')
      expect(
        await db.select().from(buildJob).where(eq(buildJob.siteId, mine.id)),
      ).toHaveLength(before.length)
      // Same for a job: cancelJob authorizes through the job's own site.
      const cancel = await call(
        publishingFns.cancelJobFn,
        { id: w.Y.job.id },
        'ownerX',
      )
      expect(classify(cancel.error)).toBe('not-found')
    })

    it('restoreRevision cannot pull a revision of another tenant entry into a caller entry', async () => {
      const { contentFns } = await fns()
      const { entryRevision } = await import('#/db/schema')
      const mine = await w.fresh.entry('X')
      const [foreign] = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.entryId, w.Y.entry.id))
        .limit(1)
      expect(foreign).toBeTruthy()
      const out = await call(
        contentFns.restoreRevisionFn,
        {
          entryId: mine.id,
          revisionId: foreign.id,
          expectedVersion: mine.draftVersion,
        },
        'ownerX',
      )
      expect(classify(out.error)).toBe('not-found')
    })

    it('schema writes are agency-only: owners of the same org cannot edit or delete collections', async () => {
      const { contentFns } = await fns()
      const c = await w.fresh.collection('X')
      const upsert = await call(
        contentFns.upsertCollectionFn,
        {
          siteId: w.X.site.id,
          key: c.key,
          label: 'Hijacked',
          routePattern: '/h/$slug',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
        'ownerX',
      )
      expect(classify(upsert.error)).toBe('forbidden')
      const del = await call(
        contentFns.deleteCollectionFn,
        { siteId: w.X.site.id, key: c.key },
        'ownerX',
      )
      expect(classify(del.error)).toBe('forbidden')
      const [row] = await db
        .select()
        .from(collection)
        .where(eq(collection.id, c.id))
      expect(row?.label).toBe('Articles')
    })

    it('an agency admin with a stale session can still do normal admin work, but not step-up actions', async () => {
      const { adminFns } = await fns()
      const list = await call(
        adminFns.listOrganizationsFn,
        undefined,
        'adminStale',
      )
      expect(list.error).toBeUndefined()
      const del = await call(
        adminFns.setAgencyAdminFn,
        { userId: w.users.ownerX.id, isAgencyAdmin: true },
        'adminStale',
      )
      expect(classify(del.error)).toBe('reauth')
    })

    it('a recorded step-up re-opens step-up actions for that session only', async () => {
      const { adminFns } = await fns()
      const { recordStepUp } = await import('./step-up')
      const stale = w.sessions.adminStale!
      const target = await w.fresh.user('stepup-target')
      const payload = { userId: target.id, isAgencyAdmin: true }
      expect(
        classify(
          (await call(adminFns.setAgencyAdminFn, payload, 'adminStale')).error,
        ),
      ).toBe('reauth')
      await recordStepUp(stale.session.id, stale.user.id)
      expect(
        (await call(adminFns.setAgencyAdminFn, payload, 'adminStale')).error,
      ).toBeUndefined()
    })

    it('signed-in dashboards are scoped to the caller tenant and hide the audit trail from editors', async () => {
      const { overviewFns, homeFns } = await fns()
      const overviewY = await call(
        overviewFns.getSitesOverviewFn,
        undefined,
        'ownerY',
      )
      const sitesY = (
        overviewY.result as { sites: Array<{ id: string }> }
      ).sites.map((s) => s.id)
      expect(sitesY).toContain(w.Y.site.id)
      expect(sitesY).not.toContain(w.X.site.id)

      const overviewEditor = await call(
        overviewFns.getSitesOverviewFn,
        undefined,
        'editorX',
      )
      const sitesE = (
        overviewEditor.result as { sites: Array<{ id: string }> }
      ).sites.map((s) => s.id)
      expect(sitesE).toContain(w.X.site.id)
      expect(sitesE).not.toContain(w.Y.site.id)

      const homeOwnerY = await call(
        homeFns.getHomeActivityFn,
        undefined,
        'ownerY',
      )
      const activityY = (
        homeOwnerY.result as { activity: Array<{ organizationId: string }> }
      ).activity
      expect(activityY.length).toBeGreaterThan(0)
      expect(activityY.every((a) => a.organizationId === w.Y.org.id)).toBe(true)

      const homeEditor = await call(
        homeFns.getHomeActivityFn,
        undefined,
        'editorX',
      )
      expect((homeEditor.result as { activity: unknown[] }).activity).toEqual(
        [],
      )

      const overviewAdmin = await call(
        overviewFns.getSitesOverviewFn,
        undefined,
        'adminMfa',
      )
      const sitesA = (
        overviewAdmin.result as { sites: Array<{ id: string }> }
      ).sites.map((s) => s.id)
      expect(sitesA).toEqual(expect.arrayContaining([w.X.site.id, w.Y.site.id]))
    })

    it('getMe reports only the caller own memberships and sites', async () => {
      const { meFns } = await fns()
      const anon = await call(meFns.getMeFn, undefined, 'anonymous')
      expect(anon.result).toBeNull()
      const me = (await call(meFns.getMeFn, undefined, 'ownerY')).result as {
        memberships: Array<{ organizationId: string }>
        sites: Array<{ id: string }>
        user: { isAgencyAdmin: boolean }
      }
      expect(me.memberships.map((m) => m.organizationId)).toEqual([w.Y.org.id])
      expect(me.sites.map((s) => s.id)).toEqual([w.Y.site.id])
      expect(me.user.isAgencyAdmin).toBe(false)
      const noMfa = (await call(meFns.getMeFn, undefined, 'adminNoMfa'))
        .result as {
        mfaEnrolmentRequired: boolean
      }
      expect(noMfa.mfaEnrolmentRequired).toBe(true)
    })

    it('step-up verification only runs for sessions that have two-factor', async () => {
      const { securityFns } = await fns()
      const noFactor = await call(
        securityFns.verifyStepUpFn,
        { code: '000000' },
        'adminNoMfa',
      )
      const withFactor = await call(
        securityFns.verifyStepUpFn,
        { code: '000000' },
        'adminMfa',
      )
      expect(classify(noFactor.error)).toBe('forbidden')
      expect(classify(withFactor.error)).toBe('forbidden')
      expect((noFactor.error as Error).message).not.toBe(
        (withFactor.error as Error).message,
      )
      expect((withFactor.error as Error).message).toMatch(/did not work/)
    })

    describe('invitations', () => {
      it('are bearer-token gated: valid token readable, expired/accepted/revoked ones are NotFound', async () => {
        const { meFns } = await fns()
        const valid = await w.fresh.invitation('X')
        const expired = await w.fresh.invitation('X', {
          expiresAt: new Date(Date.now() - 1000),
        })
        const accepted = await w.fresh.invitation('X', {
          acceptedAt: new Date(),
        })
        const revoked = await w.fresh.invitation('X')
        await db.delete(invitation).where(eq(invitation.id, revoked.id))

        expect(
          (
            await call(
              meFns.getInvitationFn,
              { token: valid.token },
              'anonymous',
            )
          ).error,
        ).toBeUndefined()
        for (const inv of [expired, accepted, revoked]) {
          const out = await call(
            meFns.getInvitationFn,
            { token: inv.token },
            'anonymous',
          )
          expect(classify(out.error)).toBe('not-found')
          const accept = await call(
            meFns.acceptInvitationFn,
            { token: inv.token },
            'ownerY',
          )
          expect(classify(accept.error)).toBe('not-found')
        }
      })

      it('cannot be accepted by a different signed-in user (no membership gained)', async () => {
        const { meFns } = await fns()
        const inv = await w.fresh.invitation('X', {
          email: 'someone-else@authz.test',
          role: 'owner',
        })
        const out = await call(
          meFns.acceptInvitationFn,
          { token: inv.token },
          'ownerY',
        )
        expect(out.error).toBeDefined()
        expect(classify(out.error)).not.toBe('internal')
        const rows = await db
          .select()
          .from(membership)
          .where(eq(membership.userId, w.users.ownerY.id))
        expect(rows.map((r) => r.organizationId)).toEqual([w.Y.org.id])
      })

      it('anonymous callers cannot accept at all', async () => {
        const { meFns } = await fns()
        const inv = await w.fresh.invitation('X')
        expect(
          classify(
            (
              await call(
                meFns.acceptInvitationFn,
                { token: inv.token },
                'anonymous',
              )
            ).error,
          ),
        ).toBe('login')
      })
    })

    describe('resource existence oracle', () => {
      it('anonymous callers learn nothing about which site/entry IDs exist', async () => {
        const { contentFns, publishingFns } = await fns()
        const real = await call(
          contentFns.listCollectionsFn,
          { siteId: w.X.site.id },
          'anonymous',
        )
        const fake = await call(
          contentFns.listCollectionsFn,
          { siteId: crypto.randomUUID() },
          'anonymous',
        )
        expect(classify(real.error)).toBe('login')
        expect(classify(fake.error)).toBe('login')
        expect(
          classify(
            (
              await call(
                contentFns.getEntryFn,
                { id: crypto.randomUUID() },
                'anonymous',
              )
            ).error,
          ),
        ).toBe('login')
        expect(
          classify(
            (
              await call(
                publishingFns.getBuildJobFn,
                { id: crypto.randomUUID() },
                'anonymous',
              )
            ).error,
          ),
        ).toBe('login')
      })

      it('anonymous callers cannot probe invitation IDs', async () => {
        const { adminFns } = await fns()
        const real = await w.fresh.invitation('X')
        for (const fn of [
          adminFns.revokeInvitationFn,
          adminFns.resendInvitationFn,
        ]) {
          const a = await call(fn, { id: real.id }, 'anonymous')
          const b = await call(fn, { id: crypto.randomUUID() }, 'anonymous')
          expect(classify(a.error)).toBe('login')
          expect(classify(b.error)).toBe('login')
        }
      })

      it('signed-in callers cannot tell another tenant object from a missing one', async () => {
        const { contentFns, publishingFns, adminFns, assetFns } = await fns()
        const invitationY = await w.fresh.invitation('Y')
        const missing = () => crypto.randomUUID()
        const cases: Array<[string, unknown, unknown, unknown]> = [
          [
            'site',
            contentFns.listCollectionsFn,
            { siteId: w.Y.site.id },
            { siteId: missing() },
          ],
          [
            'site (publishing)',
            publishingFns.listPublicationsFn,
            { siteId: w.Y.site.id },
            { siteId: missing() },
          ],
          [
            'entry',
            contentFns.getEntryFn,
            { id: w.Y.entry.id },
            { id: missing() },
          ],
          [
            'build job',
            publishingFns.getBuildJobFn,
            { id: w.Y.job.id },
            { id: missing() },
          ],
          [
            'invitation (revoke)',
            adminFns.revokeInvitationFn,
            { id: invitationY.id },
            { id: missing() },
          ],
          [
            'invitation (resend)',
            adminFns.resendInvitationFn,
            { id: invitationY.id },
            { id: missing() },
          ],
          [
            'asset (update)',
            assetFns.updateAssetFn,
            { id: w.Y.asset.id, altText: 'x' },
            { id: missing(), altText: 'x' },
          ],
          [
            'asset (delete)',
            assetFns.deleteAssetFn,
            { id: w.Y.asset.id },
            { id: missing() },
          ],
        ]
        for (const [label, fn, foreignInput, missingInput] of cases) {
          const foreign = await call(fn, foreignInput, 'ownerX')
          const absent = await call(fn, missingInput, 'ownerX')
          expect(classify(foreign.error), label).toBe('not-found')
          expect(classify(absent.error), label).toBe('not-found')
          expect((foreign.error as Error).message, label).toBe(
            (absent.error as Error).message,
          )
        }
        // getAsset answers null in both cases.
        const foreignAsset = await call(
          assetFns.getAssetFn,
          { id: w.Y.asset.id },
          'ownerX',
        )
        const missingAsset = await call(
          assetFns.getAssetFn,
          { id: missing() },
          'ownerX',
        )
        expect(foreignAsset.error).toBeUndefined()
        expect(foreignAsset.result).toBeNull()
        expect(missingAsset.result).toBeNull()
      })

      it('a member with too low a role still gets Forbidden (they know the object exists)', async () => {
        const { contentFns } = await fns()
        const out = await call(
          contentFns.publishEntryFn,
          { id: w.X.entry.id },
          'editorX',
        )
        expect(classify(out.error)).toBe('forbidden')
      })
    })
  },
)

describe.skipIf(!runnable)('disabled site content reached by entry id', () => {
  let w: World
  beforeAll(async () => {
    w = await seedWorld()
  }, 60_000)
  afterAll(async () => {
    await w?.destroy()
  })

  const call = (fn: unknown, data: unknown, actor: ActorName) =>
    callServerFn(
      fn as Parameters<typeof callServerFn>[0],
      data,
      w.sessions[actor],
    )

  it('answers NotFound to editors and owners for a disabled section entry, but not to agency admins', async () => {
    const { contentFns } = await fns()
    const section = await w.fresh.global('X')
    await db
      .update(collection)
      .set({ enabled: false })
      .where(eq(collection.id, section.collection.id))
    const id = section.entry.id
    const attempts = [
      ['getEntryFn', contentFns.getEntryFn, { id }],
      [
        'updateDraftFn',
        contentFns.updateDraftFn,
        { id, data: {}, expectedVersion: 1 },
      ],
      ['listRevisionsFn', contentFns.listRevisionsFn, { entryId: id }],
      ['publishEntryFn', contentFns.publishEntryFn, { id }],
      ['cancelScheduleFn', contentFns.cancelScheduleFn, { id }],
    ] as const
    for (const actor of ['editorX', 'ownerX'] as const) {
      for (const [name, fn, data] of attempts) {
        const out = await call(fn, data, actor)
        expect(classify(out.error), `${actor} ${name}`).toBe('not-found')
      }
    }

    const agency = await call(contentFns.getEntryFn, { id }, 'adminMfa')
    expect(agency.error).toBeUndefined()
    expect(agency.result).toMatchObject({ id, slug: '$global' })
  })
})
describe.skipIf(!runnable)('error shape that reaches the client', () => {
  let w: World
  beforeAll(async () => {
    w = await seedWorld()
  }, 60_000)
  afterAll(async () => {
    vi.restoreAllMocks()
    await w?.destroy()
  })

  const call = (fn: unknown, data: unknown, actor: ActorName) =>
    callServerFn(
      fn as Parameters<typeof callServerFn>[0],
      data,
      w.sessions[actor],
    )

  it('replaces an unexpected internal error with a generic message (no internals)', async () => {
    const { adminFns } = await fns()
    const restore = setLogSink(() => {})
    const secret =
      'connect ECONNREFUSED 10.9.8.7:5432 password=hunter2 relation "user"'
    const spy = vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error(secret)
    })
    try {
      const out = await call(adminFns.listUsersFn, undefined, 'adminMfa')
      const error = out.error as Error
      expect(error.message).toMatch(
        /^Something went wrong \(ref: [a-f0-9]{10}\)$/,
      )
      expect(
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      ).not.toContain('hunter2')
      expect(error.stack ?? '').not.toContain('hunter2')
    } finally {
      spy.mockRestore()
      restore()
    }
  })

  it('does not echo validator internals for malformed input (generic message too)', async () => {
    const { contentFns } = await fns()
    const restore = setLogSink(() => {})
    try {
      const out = await call(contentFns.getEntryFn, { id: 12345 }, 'ownerX')
      expect((out.error as Error).message).toMatch(
        /^Something went wrong \(ref: [a-f0-9]{10}\)$/,
      )
    } finally {
      restore()
    }
  })

  it('lets typed, user-facing errors through unchanged', async () => {
    const { contentFns } = await fns()
    const out = await call(
      contentFns.getEntryFn,
      { id: crypto.randomUUID() },
      'ownerX',
    )
    expect(out.error).toBeInstanceOf(NotFoundError)
    expect(sanitizeServerError(out.error)).toBe(out.error)
  })

  it('forbidden/MFA/reauth outcomes keep their machine-readable code', async () => {
    const { adminFns } = await fns()
    const mfa = await call(adminFns.listUsersFn, undefined, 'adminNoMfa')
    expect(classify(mfa.error)).toBe('mfa')
    expect((mfa.error as Error).message).toMatch(/^MFA_REQUIRED:/)
    const reauth = await call(
      adminFns.setAgencyAdminFn,
      { userId: w.users.ownerX.id, isAgencyAdmin: true },
      'adminStale',
    )
    expect((reauth.error as Error).message).toMatch(/^REAUTH_REQUIRED:/)
    const forbidden = await call(adminFns.listUsersFn, undefined, 'ownerX')
    expect(forbidden.error).toBeInstanceOf(Response)
    expect((forbidden.error as Response).status).toBe(403)
  })

  it('never leaves a stale identity behind between calls', async () => {
    setCurrentSession(null)
    const { adminFns } = await fns()
    const out = await callServerFn(
      adminFns.listUsersFn as never,
      undefined,
      null,
    )
    expect(classify(out.error)).toBe('login')
  })
})

async function fns() {
  return {
    adminFns: await import('#/server/fn/admin'),
    assetFns: await import('#/server/fn/assets'),
    contentFns: await import('#/server/fn/content'),
    publishingFns: await import('#/server/fn/publishing'),
    meFns: await import('#/server/fn/me'),
    overviewFns: await import('#/server/fn/overview'),
    homeFns: await import('#/server/fn/home'),
    securityFns: await import('#/server/fn/security'),
  }
}

// Silence unused imports kept for readability of the DB assertions above.
void site
