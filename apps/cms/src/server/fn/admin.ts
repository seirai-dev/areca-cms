import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
  requireOrgMember,
  requireOrgMemberOrNotFound,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { listAuditLog } from '#/server/admin/audit'
import {
  getDokployCredentialStatus,
  removeDokployCredentials,
  saveDokployCredentials,
  verifyDokployCredentials,
} from '#/server/admin/dokploy-credentials'
import {
  getInvitationById,
  inviteMember,
  listInvitations,
  listMembers,
  listUsers,
  removeMember,
  resendInvitation,
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
import { AI_PROMPT_MAX_LENGTH } from '#/server/ai/settings'
import {
  previewMainChange,
  setSiteLanguages,
} from '#/server/admin/site-languages'
import { localeTagSchema } from '#/lib/content-locale'
import { MAX_SITE_LANGUAGES } from '#/lib/content-limits'
import { NotFoundError } from '#/server/content/errors'
import { pageLimitSchema, pageOffsetSchema } from '#/server/pagination'

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
    const session = await requireAgencyAdmin()
    return updateOrganization(data.id, { name: data.name }, session.user.id)
  })

export const deleteOrganizationFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    await deleteOrganization(data.id, session.user.id)
    return { ok: true as const }
  })

export const getDokployCredentialStatusFn = createServerFn({
  method: 'GET',
  ...adminFn,
})
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return getDokployCredentialStatus(data.organizationId)
  })

export const saveDokployCredentialsFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(
    z.object({
      organizationId: z.string().min(1),
      url: z.url(),
      apiKey: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return saveDokployCredentials({
      ...data,
      actorId: session.user.id,
    })
  })

export const verifyDokployCredentialsFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return verifyDokployCredentials({
      organizationId: data.organizationId,
      actorId: session.user.id,
    })
  })

export const removeDokployCredentialsFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return removeDokployCredentials({
      organizationId: data.organizationId,
      actorId: session.user.id,
    })
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
    const session = await requireFreshAgencyAdmin()
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
      publishingMode: z.enum(['production', 'demo']).optional(),
      deploymentTarget: deploymentTargetSchema.optional(),
      aiPrompt: z.string().max(AI_PROMPT_MAX_LENGTH).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    const { id, ...patch } = data
    return updateSite(id, patch, session.user.id)
  })

export const setSiteLanguagesFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      id: z.string().min(1),
      main: localeTagSchema,
      all: z.array(localeTagSchema).min(1).max(MAX_SITE_LANGUAGES),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return setSiteLanguages(
      data.id,
      { main: data.main, all: data.all },
      session.user.id,
    )
  })

/** Entries and sections that would lack the new main language. */
export const previewMainLanguageChangeFn = createServerFn({
  method: 'GET',
  ...adminFn,
})
  .validator(z.object({ id: z.string().min(1), main: localeTagSchema }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return { gaps: await previewMainChange(data.id, data.main) }
  })

export const rotateSiteTokenFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(
    z.object({
      id: z.string().min(1),
      privilege: z.enum(['build', 'schema']).default('build'),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return rotateSiteTokenAdmin(data.id, data.privilege, session.user.id)
  })

export const deleteSiteFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    await deleteSite(data.id, session.user.id)
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
    const session = await requireOrgMember(data.organizationId, 'owner')
    return updateMemberRole(
      data.organizationId,
      data.userId,
      data.role,
      session.user.id,
    )
  })

export const removeMemberFn = createServerFn({ method: 'POST', ...adminFn })
  .validator(
    z.object({
      organizationId: z.string().min(1),
      userId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireOrgMember(data.organizationId, 'owner')
    await removeMember(data.organizationId, data.userId, session.user.id)
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
    await requireUser()
    const existing = await getInvitationById(data.id)
    if (!existing) {
      throw new NotFoundError(m.server_invitation_not_found())
    }
    const session = await requireOrgMemberOrNotFound(
      existing.organizationId,
      'owner',
      () => new NotFoundError(m.server_invitation_not_found()),
    )
    await revokeInvitation(data.id, session.user.id)
    return { ok: true as const }
  })

export const resendInvitationFn = createServerFn({
  method: 'POST',
  ...adminFn,
})
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireUser()
    const existing = await getInvitationById(data.id)
    if (!existing) {
      throw new NotFoundError(m.server_invitation_not_found())
    }
    const session = await requireOrgMemberOrNotFound(
      existing.organizationId,
      'owner',
      () => new NotFoundError(m.server_invitation_not_found()),
    )
    await resendInvitation(data.id, session.user.id)
    return { ok: true as const }
  })

export const listAuditLogFn = createServerFn({ method: 'GET', ...adminFn })
  .validator(
    z.object({
      organizationId: z.string().min(1).optional(),
      siteId: z.string().min(1).optional(),
      limit: pageLimitSchema,
      offset: pageOffsetSchema,
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
    const session = await requireFreshAgencyAdmin()
    return setAgencyAdmin(data.userId, data.isAgencyAdmin, session.user.id)
  })

export const listUsersFn = createServerFn({
  method: 'GET',
  ...adminFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return listUsers()
})
