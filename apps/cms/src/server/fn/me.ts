import { createServerFn } from '@tanstack/react-start'
import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { membership, organization, site } from '#/db/schema'
import type { MembershipRole } from '#/lib/types'
import { getSession, requireUser } from '#/lib/session.server'
import { acceptInvitation, getInvitation } from '#/server/admin/members'
import { NotFoundError } from '#/server/content/errors'

const meFn = { strict: { output: false } as const }

export type Me = {
  user: {
    id: string
    name: string
    email: string
    isAgencyAdmin: boolean
  }
  memberships: Array<{
    organizationId: string
    organizationName: string
    organizationSlug: string
    role: MembershipRole
  }>
  sites: Array<{
    id: string
    name: string
    slug: string
    organizationId: string
    organizationName: string
    productionUrl: string
  }>
  organizationCount: number
}

export const getMeFn = createServerFn({ method: 'GET', ...meFn }).handler(
  async (): Promise<Me | null> => {
    const session = await getSession()
    if (!session) {
      return null
    }

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
      organizationName: organization.name,
      productionUrl: site.productionUrl,
    }

    const sites = currentUser.isAgencyAdmin
      ? await db
          .select(siteColumns)
          .from(site)
          .innerJoin(organization, eq(site.organizationId, organization.id))
          .orderBy(site.name)
      : memberships.length === 0
        ? []
        : await db
            .select(siteColumns)
            .from(site)
            .innerJoin(organization, eq(site.organizationId, organization.id))
            .where(
              inArray(
                site.organizationId,
                memberships.map((m) => m.organizationId),
              ),
            )
            .orderBy(site.name)

    const organizationCount = currentUser.isAgencyAdmin
      ? Number(
          (
            await db
              .select({ n: sql<number>`cast(count(*) as int)` })
              .from(organization)
          )[0]?.n ?? 0,
        )
      : memberships.length

    return { user: currentUser, memberships, sites, organizationCount }
  },
)

export const getInvitationFn = createServerFn({ method: 'GET', ...meFn })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const invite = await getInvitation(data.token)
    if (!invite) {
      throw new NotFoundError('Invitation not found')
    }

    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, invite.organizationId))
      .limit(1)

    return {
      email: invite.email,
      role: invite.role,
      organizationId: invite.organizationId,
      organizationName: org?.name ?? 'Organization',
    }
  })

export const acceptInvitationFn = createServerFn({ method: 'POST', ...meFn })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireUser()
    return acceptInvitation({ token: data.token, userId: session.user.id })
  })
