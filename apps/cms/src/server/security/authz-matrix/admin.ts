import type * as adminFns from '#/server/fn/admin'
import { and, eq, isNull } from 'drizzle-orm'
import {
  cloudflareCredential,
  dokployCredential,
  invitation,
  membership,
  organization,
  site,
  user,
} from '#/db/schema'
import { hashToken } from '#/server/security/token-hash'

import { absent, exists, uniq } from './shared'
import type { MatrixFor } from './shared'

export const adminRows = {
  listOrganizationsFn: { policy: 'agency' },
  createOrganizationFn: {
    policy: 'agency',
    prepare: (w) => {
      const slug = `authz-${w.run}-${uniq()}`
      return {
        data: { name: 'Sneaky org', slug },
        untouched: absent(organization, eq(organization.slug, slug)),
      }
    },
  },
  updateOrganizationFn: {
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
  deleteOrganizationFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const org = await w.fresh.org()
      return {
        data: { id: org.id },
        untouched: exists(organization, eq(organization.id, org.id)),
      }
    },
  },
  getDokployCredentialStatusFn: {
    policy: 'agency',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  saveDokployCredentialsFn: {
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
  verifyDokployCredentialsFn: {
    policy: 'agency',
    tolerant: true,
    prepare: async (w) => ({
      data: { organizationId: (await w.fresh.org()).id },
    }),
  },
  removeDokployCredentialsFn: {
    policy: 'agency-fresh',
    tolerant: true,
    prepare: async (w) => ({
      data: { organizationId: (await w.fresh.org()).id },
    }),
  },
  getCloudflareCredentialStatusFn: {
    policy: 'agency',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  saveCloudflareCredentialsFn: {
    policy: 'agency-fresh',
    tolerant: true,
    prepare: async (w) => {
      const org = await w.fresh.org()
      return {
        data: {
          organizationId: org.id,
          accountId: '0123456789abcdef0123456789abcdef',
          apiToken: 'attacker-token',
        },
        untouched: absent(
          cloudflareCredential,
          eq(cloudflareCredential.organizationId, org.id),
        ),
      }
    },
  },
  verifyCloudflareCredentialsFn: {
    policy: 'agency',
    tolerant: true,
    prepare: async (w) => ({
      data: { organizationId: (await w.fresh.org()).id },
    }),
  },
  removeCloudflareCredentialsFn: {
    policy: 'agency-fresh',
    tolerant: true,
    prepare: async (w) => ({
      data: { organizationId: (await w.fresh.org()).id },
    }),
  },
  listCloudflareDeployTargetsFn: {
    policy: 'agency',
    doc: "agency admin (MFA); lists the client's Cloudflare Pages and Workers (outbound calls, no audit)",
    tolerant: true,
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  listSitesFn: {
    policy: 'agency',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  getSiteFn: {
    policy: 'agency',
    prepare: (w) => ({ data: { id: w.X.site.id } }),
  },
  createSiteFn: {
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
  updateSiteFn: {
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id, name: 'Hijacked' },
        untouched: exists(site, and(eq(site.id, s.id), eq(site.name, s.name))),
      }
    },
  },
  changeSiteSlugFn: {
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        // Unique per actor: an allowed call takes the slug, so reusing it
        // would turn the next allowed call into a conflict.
        data: {
          id: s.id,
          slug: `hijacked-${crypto.randomUUID().slice(0, 8)}`,
        },
        untouched: exists(site, and(eq(site.id, s.id), eq(site.slug, s.slug))),
      }
    },
  },
  setSiteLanguagesFn: {
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id, main: 'nl', all: ['nl', 'en'] },
        untouched: exists(site, and(eq(site.id, s.id), isNull(site.languages))),
      }
    },
  },
  previewMainLanguageChangeFn: {
    policy: 'agency',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return { data: { id: s.id, main: 'en' } }
    },
  },
  rotateSiteTokenFn: {
    policy: 'agency-fresh',
    doc: 'agency admin (MFA) with fresh session (step-up); rotates the build or schema token according to `privilege`',
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
  deleteSiteFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const s = await w.fresh.site()
      return {
        data: { id: s.id },
        untouched: exists(site, eq(site.id, s.id)),
      }
    },
  },
  listMembersFn: {
    policy: 'org-owner',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  updateMemberRoleFn: {
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
  removeMemberFn: {
    policy: 'org-owner',
    prepare: async (w) => {
      const m = await w.fresh.membership('X', 'editor')
      return {
        data: { organizationId: w.X.org.id, userId: m.user.id },
        untouched: exists(membership, eq(membership.id, m.membership.id)),
      }
    },
  },
  inviteMemberFn: {
    policy: 'org-owner',
    prepare: (w) => {
      const email = `invite-${uniq()}@authz.test`
      return {
        data: { organizationId: w.X.org.id, email, role: 'owner' },
        untouched: absent(invitation, eq(invitation.email, email)),
      }
    },
  },
  listInvitationsFn: {
    policy: 'org-owner',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  revokeInvitationFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const inv = await w.fresh.invitation('X')
      return {
        data: { id: inv.id },
        untouched: exists(invitation, eq(invitation.id, inv.id)),
      }
    },
  },
  resendInvitationFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const inv = await w.fresh.invitation('X')
      return {
        data: { id: inv.id },
        untouched: exists(
          invitation,
          and(
            eq(invitation.id, inv.id),
            eq(invitation.tokenHash, hashToken(inv.token)),
          ),
        ),
      }
    },
  },
  regenerateInvitationLinkFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const inv = await w.fresh.invitation('X')
      return {
        data: { id: inv.id },
        untouched: exists(
          invitation,
          and(
            eq(invitation.id, inv.id),
            eq(invitation.tokenHash, hashToken(inv.token)),
          ),
        ),
      }
    },
  },
  listAuditLogFn: [
    {
      variant: 'organizationId',
      policy: 'org-owner',
      prepare: (w) => ({
        data: { organizationId: w.X.org.id, limit: 20, offset: 0 },
      }),
    },
    {
      variant: 'instance-wide',
      policy: 'agency',
      prepare: () => ({ data: { limit: 20, offset: 0 } }),
    },
  ],
  setAgencyAdminFn: {
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
  listUsersFn: { policy: 'agency' },
  listPendingInvitationsFn: { policy: 'agency' },
} satisfies MatrixFor<typeof adminFns>
