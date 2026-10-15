/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
/**
 * The authorization matrix as data: every server function in
 * `src/server/fn/**`, the policy its guards are supposed to implement, and a
 * `prepare` that builds a valid payload (plus a side-effect probe) from the
 * seeded world. `authz-matrix.test.ts` runs each row as every actor.
 *
 * Human-readable version: docs/AUTHZ_MATRIX.md. Adding a server function
 * without adding a row here fails the inventory test.
 */
import { and, count, eq, isNull } from 'drizzle-orm'

import { db } from '#/db'
import {
  asset,
  buildJob,
  collection,
  aiSettings,
  dokployCredential,
  entry,
  entryRevision,
  invitation,
  membership,
  mcpConnection,
  mcpKey,
  oauthClient,
  organization,
  publication,
  site,
  user,
} from '#/db/schema'
import * as adminFns from '#/server/fn/admin'
import * as aiFns from '#/server/fn/ai'
import * as assetFns from '#/server/fn/assets'
import * as authMethodFns from '#/server/fn/auth-methods'
import * as brandingFns from '#/server/fn/branding'
import * as contentFns from '#/server/fn/content'
import * as homeFns from '#/server/fn/home'
import * as mcpKeyFns from '#/server/fn/mcp-keys'
import * as mcpOauthFns from '#/server/fn/mcp-oauth'
import * as meFns from '#/server/fn/me'
import * as overviewFns from '#/server/fn/overview'
import * as publishingFns from '#/server/fn/publishing'
import * as securityFns from '#/server/fn/security'
import * as setupFns from '#/server/fn/setup'
import { publishEntry, updateDraft } from '#/server/content/entries'
import { sampleRichText } from '#/server/content/test-utils'

import type { ActorName, Expected, Policy, World } from './authz-harness'

export type Prepared = {
  data: unknown
  /** True while the guarded resource is exactly as seeded (no side effect). */
  untouched?: () => Promise<boolean>
}

export type Row = {
  /** Export name, e.g. `deleteSiteFn`. */
  name: string
  fn: unknown
  policy: Policy
  prepare: (w: World) => Promise<Prepared> | Prepared
  /**
   * Allowed callers may hit a downstream failure that is not an
   * authorization outcome (SMTP, S3, network, business rules on throwaway
   * data). Denied callers must still be denied.
   */
  tolerant?: boolean
  /**
   * The row is addressed by an object id (site/entry/asset/job/invitation):
   * a caller outside the owning org gets the same NotFound as for a missing
   * id instead of a 403, so ids cannot be probed.
   */
  hidden?: boolean
  /** Per-actor deviations from the policy table. */
  override?: Partial<Record<ActorName, Expected>>
  note?: string
}

type AnyTable = any

type AnyWhere = any

const rowCount = async (table: AnyTable, where: AnyWhere) => {
  const [r] = await db.select({ n: count() }).from(table).where(where)
  return Number(r?.n ?? 0)
}

const exists = (table: AnyTable, where: AnyWhere) => async () =>
  (await rowCount(table, where)) > 0
const absent = (table: AnyTable, where: AnyWhere) => async () =>
  (await rowCount(table, where)) === 0

const entryUntouched =
  (id: string, expect: Partial<typeof entry.$inferSelect>) => async () => {
    const [row] = await db.select().from(entry).where(eq(entry.id, id))
    if (!row) return false
    return Object.entries(expect).every(
      ([k, v]) => (row as Record<string, unknown>)[k] === v,
    )
  }

const uniq = () => crypto.randomUUID().slice(0, 8)

export const ROWS: Row[] = [
  // ------------------------------------------------------------- admin.ts
  {
    name: 'listOrganizationsFn',
    fn: adminFns.listOrganizationsFn,
    policy: 'agency',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'createOrganizationFn',
    fn: adminFns.createOrganizationFn,
    policy: 'agency',
    prepare: (w) => {
      const slug = `authz-${w.run}-${uniq()}`
      return {
        data: { name: 'Sneaky org', slug },
        untouched: absent(organization, eq(organization.slug, slug)),
      }
    },
  },
  {
    name: 'updateOrganizationFn',
    fn: adminFns.updateOrganizationFn,
    policy: 'agency',
    prepare: async (w) => {
      const org = await w.fresh.org()
      return {
        data: { id: org.id, name: 'Renamed' },
        untouched: exists(
          organization,
          and(eq(organization.id, org.id), eq(organization.name, org.name)),
        ),
      }
    },
  },
  {
    name: 'deleteOrganizationFn',
    fn: adminFns.deleteOrganizationFn,
    policy: 'agency-fresh',
    prepare: async (w) => {
      const org = await w.fresh.org()
      return {
        data: { id: org.id },
        untouched: exists(organization, eq(organization.id, org.id)),
      }
    },
  },
  {
    name: 'getDokployCredentialStatusFn',
    fn: adminFns.getDokployCredentialStatusFn,
    policy: 'agency',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  {
    name: 'saveDokployCredentialsFn',
    fn: adminFns.saveDokployCredentialsFn,
    policy: 'agency-fresh',
    tolerant: true,
    prepare: async (w) => {
      const org = await w.fresh.org()
      return {
        data: {
          organizationId: org.id,
          url: 'https://dokploy.authz.invalid',
          apiKey: 'attacker-key',
        },
        untouched: absent(
          dokployCredential,
          eq(dokployCredential.organizationId, org.id),
        ),
      }
    },
  },
  {
    name: 'verifyDokployCredentialsFn',
    fn: adminFns.verifyDokployCredentialsFn,
    policy: 'agency',
    tolerant: true,
    prepare: async (w) => ({
      data: { organizationId: (await w.fresh.org()).id },
    }),
  },
  {
    name: 'removeDokployCredentialsFn',
    fn: adminFns.removeDokployCredentialsFn,
    policy: 'agency-fresh',
    tolerant: true,
    prepare: async (w) => ({
      data: { organizationId: (await w.fresh.org()).id },
    }),
  },
  {
    name: 'listSitesFn',
    fn: adminFns.listSitesFn,
    policy: 'agency',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  {
    name: 'getSiteFn',
    fn: adminFns.getSiteFn,
    policy: 'agency',
    prepare: (w) => ({ data: { id: w.X.site.id } }),
  },
  {
    name: 'createSiteFn',
    fn: adminFns.createSiteFn,
    policy: 'agency-fresh',
    prepare: (w) => {
      const slug = `authz-${w.run}-${uniq()}`
      return {
        data: {
          organizationId: w.X.org.id,
          name: 'Rogue site',
          slug,
          productionUrl: 'https://rogue.example.test',
        },
        untouched: absent(site, eq(site.slug, slug)),
      }
    },
  },
  {
    name: 'updateSiteFn',
    fn: adminFns.updateSiteFn,
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id, name: 'Hijacked' },
        untouched: exists(site, and(eq(site.id, s.id), eq(site.name, s.name))),
      }
    },
  },
  {
    name: 'setSiteLanguagesFn',
    fn: adminFns.setSiteLanguagesFn,
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id, main: 'nl', all: ['nl', 'en'] },
        untouched: exists(site, and(eq(site.id, s.id), isNull(site.languages))),
      }
    },
  },
  {
    name: 'previewMainLanguageChangeFn',
    fn: adminFns.previewMainLanguageChangeFn,
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return { data: { id: s.id, main: 'en' } }
    },
  },
  {
    name: 'rotateSiteTokenFn',
    fn: adminFns.rotateSiteTokenFn,
    policy: 'agency-fresh',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id, privilege: 'schema' },
        untouched: exists(
          site,
          and(
            eq(site.id, s.id),
            eq(site.schemaTokenHash, s.schemaTokenHash as string),
          ),
        ),
      }
    },
  },
  {
    name: 'deleteSiteFn',
    fn: adminFns.deleteSiteFn,
    policy: 'agency-fresh',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id },
        untouched: exists(site, eq(site.id, s.id)),
      }
    },
  },
  {
    name: 'listMembersFn',
    fn: adminFns.listMembersFn,
    policy: 'org-owner',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  {
    name: 'updateMemberRoleFn',
    fn: adminFns.updateMemberRoleFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const m = await w.fresh.membership('X', 'editor')
      return {
        data: {
          organizationId: w.X.org.id,
          userId: m.user.id,
          role: 'owner',
        },
        untouched: exists(
          membership,
          and(
            eq(membership.id, m.membership.id),
            eq(membership.role, 'editor'),
          ),
        ),
      }
    },
  },
  {
    name: 'removeMemberFn',
    fn: adminFns.removeMemberFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const m = await w.fresh.membership('X', 'editor')
      return {
        data: { organizationId: w.X.org.id, userId: m.user.id },
        untouched: exists(membership, eq(membership.id, m.membership.id)),
      }
    },
  },
  {
    name: 'inviteMemberFn',
    fn: adminFns.inviteMemberFn,
    policy: 'org-owner',
    prepare: (w) => {
      const email = `invite-${uniq()}@authz.test`
      return {
        data: { organizationId: w.X.org.id, email, role: 'owner' },
        untouched: absent(invitation, eq(invitation.email, email)),
      }
    },
  },
  {
    name: 'listInvitationsFn',
    fn: adminFns.listInvitationsFn,
    policy: 'org-owner',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  {
    name: 'revokeInvitationFn',
    hidden: true,
    fn: adminFns.revokeInvitationFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const inv = await w.fresh.invitation('X')
      return {
        data: { id: inv.id },
        untouched: exists(invitation, eq(invitation.id, inv.id)),
      }
    },
  },
  {
    name: 'resendInvitationFn',
    hidden: true,
    fn: adminFns.resendInvitationFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const inv = await w.fresh.invitation('X')
      return {
        data: { id: inv.id },
        untouched: exists(
          invitation,
          and(eq(invitation.id, inv.id), eq(invitation.token, inv.token)),
        ),
      }
    },
  },
  {
    name: 'listAuditLogFn (organizationId)',
    fn: adminFns.listAuditLogFn,
    policy: 'org-owner',
    prepare: (w) => ({
      data: { organizationId: w.X.org.id, limit: 20, offset: 0 },
    }),
  },
  {
    name: 'listAuditLogFn (instance-wide)',
    fn: adminFns.listAuditLogFn,
    policy: 'agency',
    prepare: () => ({ data: { limit: 20, offset: 0 } }),
  },
  {
    name: 'setAgencyAdminFn',
    fn: adminFns.setAgencyAdminFn,
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('promote-target')
      return {
        data: { userId: target.id, isAgencyAdmin: true },
        untouched: exists(
          user,
          and(eq(user.id, target.id), eq(user.isAgencyAdmin, false)),
        ),
      }
    },
  },
  {
    name: 'listUsersFn',
    fn: adminFns.listUsersFn,
    policy: 'agency',
    prepare: () => ({ data: undefined }),
  },

  // ----------------------------------------------------------- content.ts
  {
    name: 'listCollectionsFn',
    hidden: true,
    fn: contentFns.listCollectionsFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  {
    name: 'listEntriesFn',
    hidden: true,
    fn: contentFns.listEntriesFn,
    policy: 'org-editor',
    prepare: (w) => ({
      data: { siteId: w.X.site.id, collectionKey: 'articles' },
    }),
  },
  {
    name: 'getEntryFn',
    hidden: true,
    fn: contentFns.getEntryFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id } }),
  },
  {
    name: 'listInboundReferencesFn',
    hidden: true,
    fn: contentFns.listInboundReferencesFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id } }),
  },
  {
    name: 'createEntryFn',
    hidden: true,
    fn: contentFns.createEntryFn,
    policy: 'org-editor',
    prepare: (w) => {
      const slug = `new-${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          collectionKey: 'articles',
          data: { title: 'New', slug, body: sampleRichText },
        },
        untouched: absent(entry, eq(entry.slug, slug)),
      }
    },
  },
  {
    name: 'updateDraftFn',
    hidden: true,
    fn: contentFns.updateDraftFn,
    policy: 'org-editor',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: {
          id: e.id,
          data: { title: 'Defaced', slug: e.slug, body: sampleRichText },
          expectedVersion: e.draftVersion,
        },
        untouched: entryUntouched(e.id, { draftVersion: e.draftVersion }),
      }
    },
  },
  ...(
    [
      ['publishEntryFn', contentFns.publishEntryFn],
      ['unpublishEntryFn', contentFns.unpublishEntryFn],
      ['archiveEntryFn', contentFns.archiveEntryFn],
      ['cancelScheduleFn', contentFns.cancelScheduleFn],
    ] as const
  ).map(([name, fn]): Row => ({
    name,
    fn,
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: { id: e.id },
        untouched: entryUntouched(e.id, {
          status: 'draft',
          draftVersion: e.draftVersion,
        }),
      }
    },
  })),
  {
    name: 'scheduleEntryFn',
    hidden: true,
    fn: contentFns.scheduleEntryFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: {
          id: e.id,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          timezone: 'UTC',
        },
        untouched: entryUntouched(e.id, { status: 'draft' }),
      }
    },
  },
  {
    name: 'deleteEntryFn',
    hidden: true,
    fn: contentFns.deleteEntryFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: { id: e.id },
        untouched: exists(entry, eq(entry.id, e.id)),
      }
    },
  },
  {
    name: 'listRevisionsFn',
    hidden: true,
    fn: contentFns.listRevisionsFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { entryId: w.X.entry.id } }),
  },
  {
    name: 'restoreRevisionFn',
    hidden: true,
    fn: contentFns.restoreRevisionFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      const [rev] = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.entryId, e.id))
        .limit(1)
      return {
        data: {
          entryId: e.id,
          revisionId: rev?.id ?? 'missing',
          expectedVersion: e.draftVersion,
        },
        untouched: entryUntouched(e.id, { draftVersion: e.draftVersion }),
      }
    },
  },
  {
    name: 'getPreviewUrlFn',
    hidden: true,
    fn: contentFns.getPreviewUrlFn,
    policy: 'org-editor',
    prepare: (w) => ({
      data: {
        siteId: w.X.site.id,
        collection: 'articles',
        slug: w.X.entry.slug,
      },
    }),
  },
  {
    name: 'upsertCollectionFn',
    fn: contentFns.upsertCollectionFn,
    policy: 'agency',
    note: 'Schema changes are agency-only; org owners cannot edit their own schema.',
    prepare: (w) => {
      const key = `c${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          key,
          label: 'Injected',
          routePattern: '/injected/$slug',
          fields: [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'slug', label: 'Slug', type: 'slug' },
          ],
        },
        untouched: absent(
          collection,
          and(eq(collection.siteId, w.X.site.id), eq(collection.key, key)),
        ),
      }
    },
  },
  {
    name: 'deleteCollectionFn',
    fn: contentFns.deleteCollectionFn,
    policy: 'agency',
    prepare: async (w) => {
      const c = await w.fresh.collection('X')
      return {
        data: { siteId: w.X.site.id, key: c.key },
        untouched: exists(collection, eq(collection.id, c.id)),
      }
    },
  },

  // Site content (globals): docs/design/site-content-globals.md, "Server functions".
  {
    name: 'listGlobalsFn',
    hidden: true,
    fn: contentFns.listGlobalsFn,
    policy: 'org-editor',
    prepare: async (w) => {
      await w.fresh.global('X')
      return { data: { siteId: w.X.site.id } }
    },
  },
  {
    name: 'getGlobalFn',
    hidden: true,
    fn: contentFns.getGlobalFn,
    policy: 'org-editor',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return { data: { siteId: w.X.site.id, key: g.collection.key } }
    },
  },
  {
    name: 'getGlobalPreviewUrlFn',
    hidden: true,
    fn: contentFns.getGlobalPreviewUrlFn,
    policy: 'org-editor',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return { data: { siteId: w.X.site.id, key: g.collection.key } }
    },
  },
  {
    name: 'updateGlobalDraftFn',
    hidden: true,
    fn: contentFns.updateGlobalDraftFn,
    policy: 'org-editor',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return {
        data: {
          siteId: w.X.site.id,
          key: g.collection.key,
          data: { email: 'defaced@x.test' },
          expectedVersion: g.entry.draftVersion,
        },
        untouched: entryUntouched(g.entry.id, {
          draftVersion: g.entry.draftVersion,
        }),
      }
    },
  },
  {
    name: 'discardGlobalDraftFn',
    hidden: true,
    fn: contentFns.discardGlobalDraftFn,
    policy: 'org-editor',
    prepare: async (w) => {
      // Discard needs a ready section: publish one, then leave a newer draft.
      const g = await w.fresh.global('X')
      const actor = w.users.ownerX.id
      await updateDraft(
        g.entry.id,
        { email: 'ready@x.test' },
        actor,
        g.entry.draftVersion,
      )
      await publishEntry(g.entry.id, actor)
      await updateDraft(g.entry.id, { email: 'changed@x.test' }, actor, 2)
      return {
        data: { siteId: w.X.site.id, key: g.collection.key },
        untouched: entryUntouched(g.entry.id, { draftVersion: 3 }),
      }
    },
  },
  {
    name: 'upsertGlobalFn',
    fn: contentFns.upsertGlobalFn,
    policy: 'agency',
    note: 'Section structure is agency-only, like collection schemas.',
    prepare: (w) => {
      const key = `g${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          key,
          label: 'Injected',
          fields: [{ key: 'email', label: 'Email', type: 'text' }],
        },
        untouched: absent(
          collection,
          and(eq(collection.siteId, w.X.site.id), eq(collection.key, key)),
        ),
      }
    },
  },
  {
    name: 'deleteGlobalFn',
    fn: contentFns.deleteGlobalFn,
    policy: 'agency',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return {
        data: { siteId: w.X.site.id, key: g.collection.key },
        untouched: exists(collection, eq(collection.id, g.collection.id)),
      }
    },
  },
  {
    name: 'setGlobalEnabledFn',
    fn: contentFns.setGlobalEnabledFn,
    policy: 'agency',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return {
        data: { siteId: w.X.site.id, key: g.collection.key, enabled: false },
        untouched: exists(
          collection,
          and(eq(collection.id, g.collection.id), eq(collection.enabled, true)),
        ),
      }
    },
  },

  // ------------------------------------------------------------ assets.ts
  {
    name: 'listAssetsFn',
    fn: assetFns.listAssetsFn,
    policy: 'org-editor',
    prepare: (w) => ({
      data: { organizationId: w.X.org.id, limit: 20, offset: 0 },
    }),
  },
  {
    name: 'getAssetFn',
    note: 'Missing and foreign assets both answer null.',
    override: { ownerY: 'allowed' },
    fn: assetFns.getAssetFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.asset.id } }),
  },
  {
    name: 'updateAssetFn',
    hidden: true,
    fn: assetFns.updateAssetFn,
    policy: 'org-editor',
    prepare: async (w) => {
      const a = await w.fresh.asset('X')
      return {
        data: { id: a.id, altText: 'Changed by caller' },
        untouched: exists(
          asset,
          and(eq(asset.id, a.id), eq(asset.altText, 'original alt')),
        ),
      }
    },
  },
  {
    name: 'deleteAssetFn',
    hidden: true,
    fn: assetFns.deleteAssetFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const a = await w.fresh.asset('X')
      return {
        data: { id: a.id },
        untouched: exists(asset, eq(asset.id, a.id)),
      }
    },
  },

  // -------------------------------------------------------- publishing.ts
  {
    name: 'requestPublicationFn',
    hidden: true,
    fn: publishingFns.requestPublicationFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      return {
        data: { siteId: s.id, requestKey: crypto.randomUUID() },
        untouched: absent(publication, eq(publication.siteId, s.id)),
      }
    },
  },
  {
    name: 'requestRollbackFn',
    hidden: true,
    fn: publishingFns.requestRollbackFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(s.id, `rb-${uniq()}`, 'superseded')
      return {
        data: {
          siteId: s.id,
          publicationId: p.id,
          requestKey: crypto.randomUUID(),
        },
        untouched: absent(buildJob, eq(buildJob.siteId, s.id)),
      }
    },
  },
  {
    name: 'listPublicationsFn',
    hidden: true,
    fn: publishingFns.listPublicationsFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  {
    name: 'listBuildJobsFn',
    hidden: true,
    fn: publishingFns.listBuildJobsFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  {
    name: 'getBuildJobFn',
    hidden: true,
    fn: publishingFns.getBuildJobFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.job.id } }),
  },
  {
    name: 'cancelJobFn',
    hidden: true,
    fn: publishingFns.cancelJobFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(s.id, `cj-${uniq()}`, 'superseded')
      const j = await w.fresh.job(s.id, p.id, 'queued')
      return {
        data: { id: j.id },
        untouched: exists(
          buildJob,
          and(eq(buildJob.id, j.id), eq(buildJob.status, 'queued')),
        ),
      }
    },
  },
  {
    name: 'reconcileDeploymentJobFn',
    hidden: true,
    fn: publishingFns.reconcileDeploymentJobFn,
    policy: 'org-owner',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(
        s.id,
        `reconcile-${uniq()}`,
        'superseded',
      )
      const j = await w.fresh.job(s.id, p.id, 'succeeded')
      await db
        .update(buildJob)
        .set({ status: 'failed', dispatchUncertain: true })
        .where(eq(buildJob.id, j.id))
      return {
        data: { id: j.id },
        untouched: exists(
          buildJob,
          and(eq(buildJob.id, j.id), eq(buildJob.attempts, 0)),
        ),
      }
    },
  },
  {
    name: 'resolveUncertainDeploymentJobFn',
    fn: publishingFns.resolveUncertainDeploymentJobFn,
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site('X')
      const p = await w.fresh.publication(
        s.id,
        `resolve-${uniq()}`,
        'superseded',
      )
      const j = await w.fresh.job(s.id, p.id, 'succeeded')
      await db
        .update(buildJob)
        .set({ status: 'failed', dispatchUncertain: true })
        .where(eq(buildJob.id, j.id))
      return {
        data: {
          id: j.id,
          reason: 'Verified upstream stopped and queue drained',
          upstreamStopped: true,
        },
        untouched: exists(
          buildJob,
          and(eq(buildJob.id, j.id), eq(buildJob.dispatchUncertain, true)),
        ),
      }
    },
  },
  {
    name: 'getSiteReleaseStatusFn',
    hidden: true,
    fn: publishingFns.getSiteReleaseStatusFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  {
    name: 'listPendingReleaseChangesFn',
    hidden: true,
    fn: publishingFns.listPendingReleaseChangesFn,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },

  // ----------------------------------------------------------- branding.ts
  {
    name: 'getBrandingFn',
    fn: brandingFns.getBrandingFn,
    policy: 'public',
    note: 'Public by design: login/setup/invite pages render the brand before sign-in.',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'updateBrandingFn',
    fn: brandingFns.updateBrandingFn,
    policy: 'agency',
    prepare: () => ({ data: { appName: 'Defaced By Caller' } }),
  },
  {
    name: 'clearBrandingImageFn',
    fn: brandingFns.clearBrandingImageFn,
    policy: 'agency',
    prepare: () => ({ data: { kind: 'logo' } }),
  },
  {
    name: 'resetBrandingFn',
    fn: brandingFns.resetBrandingFn,
    policy: 'agency',
    prepare: () => ({ data: undefined }),
  },

  // ---------------------------------------------------------------- ai.ts
  {
    name: 'getAiSettingsFn',
    fn: aiFns.getAiSettingsFn,
    policy: 'agency',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'saveAiSettingsFn',
    fn: aiFns.saveAiSettingsFn,
    policy: 'agency',
    note: 'Model/prompt edits; saving or removing the API key needs a fresh second factor (agency-fresh).',
    prepare: () => {
      const model = `authz/${uniq()}`
      return {
        data: { model },
        untouched: absent(aiSettings, eq(aiSettings.model, model)),
      }
    },
  },
  {
    name: 'listAiModelsFn',
    fn: aiFns.listAiModelsFn,
    policy: 'agency',
    tolerant: true,
    note: 'Fetches the public OpenRouter catalogue; network failures are not authorization outcomes.',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'getAiAvailabilityFn',
    fn: aiFns.getAiAvailabilityFn,
    policy: 'user',
    note: 'Only a boolean; reveals nothing about the key, model or prompt.',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'generateEntrySeoFn',
    hidden: true,
    fn: aiFns.generateEntrySeoFn,
    policy: 'org-editor',
    tolerant: true,
    note: 'Allowed callers get "AI is not set up" (no key in the test world); denied callers must not reach the provider.',
    prepare: (w) => ({
      data: {
        siteId: w.X.site.id,
        collectionKey: 'articles',
        data: { title: 'AI', slug: `ai-${uniq()}` },
      },
    }),
  },

  // ------------------------------------------------- security/auth/setup/me
  {
    name: 'verifyStepUpFn',
    fn: securityFns.verifyStepUpFn,
    policy: 'user',
    tolerant: true,
    note: 'Needs a session with two-factor enabled; everyone else gets ForbiddenError.',
    override: {
      editorX: 'forbidden',
      ownerX: 'forbidden',
      ownerY: 'forbidden',
      adminNoMfa: 'forbidden',
      // 2FA sessions reach the verifier, which refuses the wrong code with a
      // ForbiddenError of its own (asserted separately).
      adminMfa: 'forbidden',
      adminStale: 'forbidden',
    },
    prepare: () => ({ data: { code: '000000' } }),
  },
  {
    name: 'resetAdminFactorLockoutFn',
    fn: securityFns.resetAdminFactorLockoutFn,
    policy: 'agency-fresh',
    prepare: (w) => ({ data: { userId: w.users.adminStale.id } }),
  },
  {
    name: 'getAuthMethodsFn',
    fn: authMethodFns.getAuthMethodsFn,
    policy: 'public',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'getSetupStatusFn',
    fn: setupFns.getSetupStatusFn,
    policy: 'public',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'completeSetupFn',
    fn: setupFns.completeSetupFn,
    policy: 'public',
    note: 'Open endpoint by design but token-gated: a wrong setup token is refused for everyone, signed in or not.',
    override: {
      anonymous: 'forbidden',
      editorX: 'forbidden',
      ownerX: 'forbidden',
      ownerY: 'forbidden',
      adminNoMfa: 'forbidden',
      adminMfa: 'forbidden',
      adminStale: 'forbidden',
    },
    prepare: () => ({
      data: {
        name: 'Intruder',
        email: `intruder-${uniq()}@authz.test`,
        password: 'correct horse battery',
        setupToken: 'definitely-not-the-setup-token',
      },
    }),
  },
  {
    name: 'getMeFn',
    fn: meFns.getMeFn,
    policy: 'public',
    note: 'Returns null when anonymous; otherwise only the caller own profile (also for an admin who still has to enrol two-factor, so the UI can show enrolment).',
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'getInvitationFn',
    fn: meFns.getInvitationFn,
    policy: 'public',
    tolerant: true,
    note: 'Bearer-token gated (unguessable invitation token); unknown token is NotFound.',
    prepare: () => ({ data: { token: 'unknown-token' } }),
  },
  {
    name: 'acceptInvitationFn',
    fn: meFns.acceptInvitationFn,
    policy: 'user',
    tolerant: true,
    note: 'Any signed-in user; the invitation token + matching e-mail do the authorization (tested separately).',
    prepare: () => ({ data: { token: 'unknown-token' } }),
  },
  {
    name: 'getSitesOverviewFn',
    fn: overviewFns.getSitesOverviewFn,
    policy: 'user',
    note: 'Scoped to the caller organizations (all for agency admins); scoping asserted separately.',
    override: { adminNoMfa: 'mfa' },
    prepare: () => ({ data: undefined }),
  },
  {
    name: 'getHomeActivityFn',
    fn: homeFns.getHomeActivityFn,
    policy: 'user',
    note: 'Scoped like the overview; editors get no audit trail (asserted separately).',
    override: { adminNoMfa: 'mfa' },
    prepare: () => ({ data: undefined }),
  },
  // ------------------------------------------------------- mcp-keys.ts
  {
    name: 'listMcpKeysFn',
    hidden: true,
    fn: mcpKeyFns.listMcpKeysFn,
    policy: 'org-editor',
    note: 'Editors see only their own keys; owners and agency admins see all keys on the site (scoping asserted separately).',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  {
    name: 'createMcpKeyFn',
    hidden: true,
    fn: mcpKeyFns.createMcpKeyFn,
    policy: 'org-editor',
    note: 'Any site member can create a personal key. Agency admins need a fresh second factor (reauth). Editors cannot allow go-live (asserted separately).',
    override: { adminStale: 'reauth' },
    prepare: (w) => {
      const name = `authz-key-${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          name,
          expiresInDays: 30,
          allowGoLive: false,
        },
        untouched: absent(mcpKey, eq(mcpKey.name, name)),
      }
    },
  },
  {
    name: 'revokeMcpKeyFn',
    hidden: true,
    fn: mcpKeyFns.revokeMcpKeyFn,
    policy: 'org-editor',
    note: 'Owners and agency admins revoke any key on the site; editors only their own. Other keys answer NotFound.',
    override: { editorX: 'not-found' },
    prepare: async (w) => {
      const [key] = await db
        .insert(mcpKey)
        .values({
          userId: w.users.ownerX.id,
          siteId: w.X.site.id,
          name: `authz-revoke-${uniq()}`,
          tokenPrefix: 'areca_mcp_authz',
          tokenHash: `authz-${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning()
      if (!key) throw new Error('mcp key insert failed')
      return {
        data: { id: key.id },
        untouched: exists(
          mcpKey,
          and(eq(mcpKey.id, key.id), isNull(mcpKey.revokedAt)),
        ),
      }
    },
  },
  // ------------------------------------------------------- mcp-oauth.ts
  {
    name: 'getOAuthConsentFn',
    fn: mcpOauthFns.getOAuthConsentFn,
    // Returns a reason instead of throwing: signed_out, invalid_request,
    // unknown_site or no_access. Those outcomes are asserted separately in
    // mcp-oauth.test.ts; this row only checks that it reads nothing it
    // should not, and that a bogus query is refused without a side effect.
    policy: 'public',
    note: 'Read-only. Non-members get reason no_access and an agency admin without 2FA gets the MFA message, both asserted separately.',
    prepare: () => ({ data: { query: 'client_id=nope&sig=nope&exp=1' } }),
  },
  {
    name: 'approveOAuthConsentFn',
    hidden: true,
    fn: mcpOauthFns.approveOAuthConsentFn,
    policy: 'org-editor',
    tolerant: true,
    note: 'Site access (NotFound for other tenants, 2FA for agency admins, fresh session for agency approval) is checked before the signed query. Editors cannot go live (asserted separately).',
    override: { adminStale: 'reauth' },
    prepare: (w) => ({
      data: {
        query: 'client_id=nope&sig=nope&exp=1',
        siteId: w.X.site.id,
        allowGoLive: false,
      },
    }),
  },
  {
    name: 'denyOAuthConsentFn',
    fn: mcpOauthFns.denyOAuthConsentFn,
    policy: 'user',
    tolerant: true,
    note: 'Any signed-in user may refuse a request addressed to them; the query must still be signed by the server.',
    prepare: () => ({ data: { query: 'client_id=nope&sig=nope&exp=1' } }),
  },
  {
    name: 'listMcpConnectionsFn',
    hidden: true,
    fn: mcpOauthFns.listMcpConnectionsFn,
    policy: 'org-editor',
    note: 'Editors see only their own connections; owners and agency admins see all (scoping asserted separately).',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  {
    name: 'revokeMcpConnectionFn',
    hidden: true,
    fn: mcpOauthFns.revokeMcpConnectionFn,
    policy: 'org-editor',
    note: 'Owners and agency admins disconnect any app on the site; editors only their own. Other connections answer NotFound.',
    override: { editorX: 'not-found' },
    prepare: async (w) => {
      const clientId = `authz-client-${uniq()}`
      await db.insert(oauthClient).values({
        clientId,
        redirectUris: ['http://localhost:9999/callback'],
        name: 'Authz app',
      })
      const [connection] = await db
        .insert(mcpConnection)
        .values({
          userId: w.users.ownerX.id,
          siteId: w.X.site.id,
          clientId,
          clientName: 'Authz app',
        })
        .returning()
      if (!connection) throw new Error('mcp connection insert failed')
      return {
        data: { id: connection.id },
        untouched: exists(
          mcpConnection,
          and(
            eq(mcpConnection.id, connection.id),
            isNull(mcpConnection.revokedAt),
          ),
        ),
      }
    },
  },
]

export const ALL_FN_MODULES = {
  admin: adminFns,
  ai: aiFns,
  assets: assetFns,
  'auth-methods': authMethodFns,
  branding: brandingFns,
  content: contentFns,
  home: homeFns,
  'mcp-keys': mcpKeyFns,
  'mcp-oauth': mcpOauthFns,
  me: meFns,
  overview: overviewFns,
  publishing: publishingFns,
  security: securityFns,
  setup: setupFns,
}
