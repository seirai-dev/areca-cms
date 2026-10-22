import type * as MailConfig from '#/server/mail/config'
import type * as Adapters from '#/adapters'
import type * as ServerAssets from '#/server/assets'
import type * as MailTransport from '#/server/mail/transport'
import { eq, inArray, or } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { auditLog, branding, organization, site, user } from '#/db/schema'

import { listAuditLog } from './audit.ts'
import {
  clearBrandingImage,
  resetBranding,
  setBrandingImage,
  updateBranding,
} from './branding.ts'
import {
  removeDokployCredentials,
  saveDokployCredentials,
} from './dokploy-credentials.ts'
import {
  acceptInvitation,
  inviteMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  setAgencyAdmin,
  updateMemberRole,
} from './members.ts'
import {
  createOrganization,
  deleteOrganization,
  updateOrganization,
} from './organizations.ts'
import {
  createSite,
  deleteSite,
  rotateSiteTokenAdmin,
  updateSite,
} from './sites.ts'

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
  sendMail: vi.fn(async () => ({ messageId: 'test-message' })),
}))
vi.mock('#/adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof Adapters>()),
  getStorage: () => ({
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }),
}))
vi.mock('#/server/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof ServerAssets>()),
  drainStorageObjectDeletions: vi.fn(async () => {}),
}))

const hasDb = Boolean(process.env.DATABASE_URL)

const appsResponse = () =>
  new Response(
    JSON.stringify({
      items: [
        {
          applicationId: 'a1',
          name: 'n',
          appName: 'n',
          applicationStatus: 'done',
        },
      ],
      total: 1,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe.skipIf(!hasDb)(
  'administrative actions write audit rows with the actor',
  () => {
    it('records every admin action, instance-level ones without an organization', async () => {
      const suffix = crypto.randomUUID()
      const mk = async (tag: string, isAgencyAdmin = false) => {
        const row = (await db
          .insert(user)
          .values({
            id: crypto.randomUUID(),
            name: tag,
            email: `${tag}-${suffix}@test.local`,
            emailVerified: true,
            isAgencyAdmin,
          })
          .returning()).at(0)
        if (!row) throw new Error('user')
        return row
      }
      const admin = await mk('admin', true)
      const second = await mk('second')
      const guest = await mk('guest')
      const orgIds: string[] = []

      try {
        // Organization lifecycle (create/update in-org, delete instance level).
        const org = await createOrganization({
          name: `Audit ${suffix}`,
          slug: `audit-${suffix}`,
          actorId: admin.id,
        })
        orgIds.push(org.id)
        await updateOrganization(
          org.id,
          { name: `Audit 2 ${suffix}` },
          admin.id,
        )
        const doomed = await createOrganization({
          name: `Doomed ${suffix}`,
          slug: `doomed-${suffix}`,
          actorId: admin.id,
        })
        await deleteOrganization(doomed.id, admin.id)

        // Sites.
        const created = await createSite({
          organizationId: org.id,
          name: `Site ${suffix}`,
          slug: `site-${suffix}`,
          productionUrl: 'https://example.test',
          actorId: admin.id,
        })
        await updateSite(created.id, { publishingMode: 'demo' }, admin.id)
        await updateSite(
          created.id,
          {
            deploymentTarget: {
              provider: 'dokploy',
              applicationId: 'a1',
              healthCheckUrl: 'https://example.test/health',
            },
          },
          admin.id,
        )
        await rotateSiteTokenAdmin(created.id, 'build', admin.id)
        await rotateSiteTokenAdmin(created.id, 'schema', admin.id)
        await deleteSite(created.id, admin.id)

        // Dokploy credentials.
        await saveDokployCredentials({
          organizationId: org.id,
          url: 'https://dokploy.example.com',
          apiKey: 'secret',
          actorId: admin.id,
          fetch: async () => appsResponse(),
        })
        await removeDokployCredentials({
          organizationId: org.id,
          actorId: admin.id,
        })

        // Members and invitations.
        const first = await inviteMember({
          organizationId: org.id,
          email: guest.email,
          role: 'editor',
          actorId: admin.id,
        })
        await resendInvitation(first.id, admin.id)
        await revokeInvitation(first.id, admin.id)
        const second2 = await inviteMember({
          organizationId: org.id,
          email: guest.email,
          role: 'owner',
          actorId: admin.id,
        })
        await acceptInvitation({ token: second2.token, userId: guest.id })
        const other = await inviteMember({
          organizationId: org.id,
          email: second.email,
          role: 'owner',
          actorId: admin.id,
        })
        await acceptInvitation({ token: other.token, userId: second.id })
        await updateMemberRole(org.id, guest.id, 'editor', admin.id)
        await removeMember(org.id, guest.id, admin.id)

        // Instance-level.
        await setAgencyAdmin(second.id, true, admin.id)
        await setAgencyAdmin(second.id, false, admin.id)
        await updateBranding({ appName: `Brand ${suffix}` }, admin.id)
        await setBrandingImage(
          'logo',
          {
            buffer: await sharp({
              create: {
                width: 1,
                height: 1,
                channels: 4,
                background: '#ffffff',
              },
            })
              .png()
              .toBuffer(),
            mimeType: 'image/png',
          },
          admin.id,
        )
        await clearBrandingImage('logo', admin.id)
        await resetBranding(admin.id)

        const rows = await db
          .select()
          .from(auditLog)
          .where(
            or(eq(auditLog.actorId, admin.id), eq(auditLog.actorId, guest.id)),
          )
        const byAction = (action: string) =>
          rows.filter((row) => row.action === action)

        const inOrg = [
          'organization.create',
          'organization.update',
          'site.create',
          'site.update',
          'site.rotate_token',
          'site.rotate_schema_token',
          'site.delete',
          'organization.dokploy_credentials_created',
          'organization.dokploy_credentials_removed',
          'member.invite',
          'invitation.resend',
          'invitation.revoke',
          'invitation.accept',
          'member.update_role',
          'member.remove',
        ]
        for (const action of inOrg) {
          const found = byAction(action).filter(
            (row) => row.organizationId === org.id,
          )
          expect(found.length, action).toBeGreaterThan(0)
          for (const row of found) {
            expect(row.actorId, action).toBe(
              action === 'invitation.accept' ? guest.id : admin.id,
            )
          }
        }
        // site.update recorded both the mode and the deployment target change.
        expect(byAction('site.update')).toHaveLength(2)

        const instance = [
          'organization.delete',
          'agency_admin.grant',
          'agency_admin.revoke',
          'branding.update',
          'branding.image_set',
          'branding.image_clear',
          'branding.reset',
        ]
        for (const action of instance) {
          const found = byAction(action)
          expect(found.length, action).toBeGreaterThan(0)
          for (const row of found) {
            expect(row.organizationId, action).toBeNull()
            expect(row.actorId, action).toBe(admin.id)
          }
        }
        expect(byAction('organization.delete')[0]?.targetId).toBe(doomed.id)

        // The listing returns instance rows without an organization name.
        const listing = await listAuditLog({ limit: 200, offset: 0 })
        const branded = listing.find(
          (row) => row.action === 'branding.reset' && row.actorId === admin.id,
        )
        expect(branded).toMatchObject({
          organizationId: null,
          organizationName: null,
        })
      } finally {
        await db
          .delete(auditLog)
          .where(
            or(
              eq(auditLog.actorId, admin.id),
              eq(auditLog.actorId, guest.id),
              eq(auditLog.actorId, second.id),
            ),
          )
        if (orgIds.length) {
          await db.delete(organization).where(inArray(organization.id, orgIds))
        }
        await db.delete(site).where(eq(site.slug, `site-${suffix}`))
        await db.delete(branding).where(eq(branding.id, 'default'))
        await db
          .delete(user)
          .where(inArray(user.id, [admin.id, second.id, guest.id]))
      }
    })
  },
)
