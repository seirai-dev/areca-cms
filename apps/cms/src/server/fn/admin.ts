import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireAgencyAdmin, requireOrgMember } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { listAuditLog } from '#/server/admin/audit'
import {
  getInvitationById,
  inviteMember,
  listInvitations,
  listMembers,
  listUsers,
  removeMember,
  revokeInvitation,
  setAgencyAdmin,
  updateMemberRole,
} from '#/server/admin/members'
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  updateOrganization,
} from '#/server/admin/organizations'
import {
  createSite,
  deleteSite,
  deploymentTargetSchema,
  getSite,
  listSites,
  rotateSiteTokenAdmin,
  updateSite,
} from '#/server/admin/sites'
import { NotFoundError } from '#/server/content/errors'

const membershipRoleSchema = z.enum(['owner', 'editor'])
const adminFn = { strict: { output: false } as const }

export const listOrganizationsFn = createServerFn({
  method: 'GET',
  ...adminFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return listOrganizations()
})

export const createOrganizationFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(
    z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return createOrganization({
      name: data.name,
      slug: data.slug,
      actorId: session.user.id,
    })
  })

export const updateOrganizationFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return updateOrganization(data.id, { name: data.name })
  })

export const deleteOrganizationFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    await deleteOrganization(data.id)
    return { ok: true as const }
  })

export const listSitesFn = createServerFn({ method: 'GET', ...adminFn })
  .validator(z.object({ organizationId: z.string().min(1).optional() }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return listSites(data.organizationId)
  })

export const getSiteFn = createServerFn({ method: 'GET', ...adminFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    const found = await getSite(data.id)
    if (!found) {
      throw new NotFoundError(m.server_site_not_found())
    }
    return found
  })

export const createSiteFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      organizationId: z.string().min(1),
      name: z.string().min(1),
      slug: z.string().min(1),
      productionUrl: z.string().url(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return createSite({
      organizationId: data.organizationId,
      name: data.name,
      slug: data.slug,
      productionUrl: data.productionUrl,
      actorId: session.user.id,
    })
  })

export const updateSiteFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      productionUrl: z.string().url().optional(),
      deploymentTarget: deploymentTargetSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    const { id, ...patch } = data
    return updateSite(id, patch)
  })

export const rotateSiteTokenFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return rotateSiteTokenAdmin(data.id)
  })

export const deleteSiteFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    await deleteSite(data.id)
    return { ok: true as const }
  })

export const listMembersFn = createServerFn({ method: 'GET', ...adminFn })
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId, 'owner')
    return listMembers(data.organizationId)
  })

export const updateMemberRoleFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(
    z.object({
      organizationId: z.string().min(1),
      userId: z.string().min(1),
      role: membershipRoleSchema,
    }),
  )
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId, 'owner')
    return updateMemberRole(data.organizationId, data.userId, data.role)
  })

export const removeMemberFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      organizationId: z.string().min(1),
      userId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId, 'owner')
    await removeMember(data.organizationId, data.userId)
    return { ok: true as const }
  })

export const inviteMemberFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      organizationId: z.string().min(1),
      email: z.email(),
      role: membershipRoleSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireOrgMember(data.organizationId, 'owner')
    return inviteMember({
      organizationId: data.organizationId,
      email: data.email,
      role: data.role,
      actorId: session.user.id,
    })
  })

export const listInvitationsFn = createServerFn({ method: 'GET', ...adminFn })
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId, 'owner')
    return listInvitations(data.organizationId)
  })

export const revokeInvitationFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const existing = await getInvitationById(data.id)
    if (!existing) {
      throw new NotFoundError(m.server_invitation_not_found())
    }
    await requireOrgMember(existing.organizationId, 'owner')
    await revokeInvitation(data.id)
    return { ok: true as const }
  })

export const listAuditLogFn = createServerFn({ method: 'GET', ...adminFn })
  .validator(
    z.object({
      organizationId: z.string().min(1).optional(),
      siteId: z.string().min(1).optional(),
      limit: z.number().int().min(1),
      offset: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }) => {
    if (data.organizationId) {
      await requireOrgMember(data.organizationId, 'owner')
    } else {
      await requireAgencyAdmin()
    }
    return listAuditLog(data)
  })

export const setAgencyAdminFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      userId: z.string().min(1),
      isAgencyAdmin: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return setAgencyAdmin(data.userId, data.isAgencyAdmin)
  })

export const listUsersFn = createServerFn({
  method: 'GET',
  ...adminFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return listUsers()
})
