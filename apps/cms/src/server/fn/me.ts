/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { membership, organization, site, user } from '#/db/schema'
import { hasAgencyWideAccess } from '#/lib/agency-access'
import { localMfaVerifiedAt } from '#/server/security/local-mfa'
import { env } from '#/env'
import type { MembershipRole, SiteLanguages } from '#/lib/types'
import { getSession, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { acceptInvitation, getInvitation } from '#/server/admin/members'
import { NotFoundError } from '#/server/content/errors'
import { mailLocale } from '#/server/mail/render/types'
import type { MailLocale } from '#/server/mail/render/types'

const meFn = { strict: { output: false } as const }

export type Me = {
  user: {
    id: string
    name: string
    email: string
    isAgencyAdmin: boolean
    twoFactorEnabled: boolean
    emailVerified: boolean
    /** Language for account emails. Null only before the first sign-in backfill. */
    locale: MailLocale | null
  }
  /** An agency admin who must enrol in two-factor before using the app. */
  mfaEnrolmentRequired: boolean
  /** Enrolled admins must verify a local factor in this session. */
  mfaVerificationRequired: boolean
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
    /** Content languages. Null = single-language site. */
    languages: SiteLanguages | null
  }>
  organizationCount: number
}

export const getMeFn = createServerFn({ method: 'GET', ...meFn }).handler(
  async (): Promise<Me | null> => {
    const session = await getSession()
    if (!session) {
      return null
    }

    const currentUser: Me['user'] = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      isAgencyAdmin: Boolean(session.user.isAgencyAdmin),
      twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
      emailVerified: Boolean(session.user.emailVerified),
      locale: session.user.locale ? mailLocale(session.user.locale) : null,
    }

    // Accounts that predate the language setting take the language they are
    // using now, once. Later changes come from Account → Email language.
    if (currentUser.locale === null) {
      const locale = getLocale()
      await db
        .update(user)
        .set({ locale })
        .where(and(eq(user.id, currentUser.id), isNull(user.locale)))
      currentUser.locale = locale
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
      languages: site.languages,
    }

    // Agency-wide data (every site, the organization count) waits until an
    // admin has verified a local factor in this session. Until then an admin
    // gets the same membership-scoped view as anyone else.
    const adminMfaRequired = env.ADMIN_MFA_REQUIRED && currentUser.isAgencyAdmin
    const mfaEnrolmentRequired =
      adminMfaRequired && !currentUser.twoFactorEnabled
    const mfaVerificationRequired =
      adminMfaRequired &&
      currentUser.twoFactorEnabled &&
      !(await localMfaVerifiedAt(session))
    const agencyWide = hasAgencyWideAccess({
      isAgencyAdmin: currentUser.isAgencyAdmin,
      adminMfaRequired: env.ADMIN_MFA_REQUIRED,
      twoFactorEnabled: currentUser.twoFactorEnabled,
      localMfaVerified: !mfaVerificationRequired,
    })

    const sites = agencyWide
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
                memberships.map((member) => member.organizationId),
              ),
            )
            .orderBy(site.name)

    const organizationCount = agencyWide
      ? Number(
          (
            await db
              .select({ n: sql<number>`cast(count(*) as int)` })
              .from(organization)
          )[0]?.n ?? 0,
        )
      : memberships.length

    return {
      user: currentUser,
      mfaEnrolmentRequired,
      mfaVerificationRequired,
      memberships,
      sites,
      organizationCount,
    }
  },
)

export const getInvitationFn = createServerFn({ method: 'GET', ...meFn })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const invite = await getInvitation(data.token)
    if (!invite) {
      throw new NotFoundError(m.server_invitation_not_found())
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
      organizationName: org?.name ?? m.server_organization(),
    }
  })

export const acceptInvitationFn = createServerFn({ method: 'POST', ...meFn })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireUser()
    return acceptInvitation({ token: data.token, userId: session.user.id })
  })
