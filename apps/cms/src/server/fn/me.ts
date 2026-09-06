import { createServerFn } from '@tanstack/react-start'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { membership, organization, site } from '#/db/schema'
import { requireUser } from '#/lib/session.server'
import { acceptInvitation, getInvitation } from '#/server/admin/members'
import { NotFoundError } from '#/server/content/errors'

const meFn = { strict: { output: false } as const }

export const getMeFn = createServerFn({ method: 'GET', ...meFn }).handler(
  async () => {
    const session = await requireUser()
    const currentUser = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      isAgencyAdmin: Boolean(session.user.isAgencyAdmin),
    }

    const memberships = await db
      .select({
        organizationId: membership.organizationId,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        role: membership.role,
      })
      .from(membership)
      .innerJoin(organization, eq(membership.organizationId, organization.id))
      .where(eq(membership.userId, session.user.id))
      .orderBy(organization.name)

    const siteColumns = {
      id: site.id,
      name: site.name,
      slug: site.slug,
      organizationId: site.organizationId,
    }

    const sites = currentUser.isAgencyAdmin
      ? await db.select(siteColumns).from(site).orderBy(site.name)
      : memberships.length === 0
        ? []
        : await db
            .select(siteColumns)
            .from(site)
            .where(
              inArray(
                site.organizationId,
                memberships.map((m) => m.organizationId),
              ),
            )
            .orderBy(site.name)

    return { user: currentUser, memberships, sites }
  },
)

export const getInvitationFn = createServerFn({ method: 'GET', ...meFn })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const invite = await getInvitation(data.token)
    if (!invite) {
      throw new NotFoundError('Invitation not found')
    }
    return invite
  })

export const acceptInvitationFn = createServerFn({ method: 'POST', ...meFn })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireUser()
    return acceptInvitation({ token: data.token, userId: session.user.id })
  })
