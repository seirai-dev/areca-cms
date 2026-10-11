/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { APIError } from 'better-auth/api'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { db } from '#/db'
import { invitation, user } from '#/db/schema'
import { m } from '#/paraglide/messages'

/**
 * Registration is invite-only, whatever the sign-in method. A brand new user
 * row may only be created when:
 *
 * - the instance has been bootstrapped, and
 * - a pending invitation exists for the email. Password signup also proves
 *   possession of its link; verified providers prove email ownership.
 *
 * Someone who already has an account never reaches this: Better Auth links the
 * social/SSO account to the existing user instead of creating a second one.
 */
export async function assertEmailMayRegister(
  email: string,
  proof?: {
    passwordSignup: boolean
    emailVerified?: boolean
    invitationToken?: unknown
  },
) {
  const normalized = email.trim().toLowerCase()

  // An empty instance is bootstrapped only by token-authorized setup.
  const [anyUser] = await db.select({ id: user.id }).from(user).limit(1)
  if (!anyUser) throw registrationDenied()
  if (!proof?.passwordSignup && !proof?.emailVerified)
    throw registrationDenied()
  if (proof.passwordSignup && typeof proof.invitationToken !== 'string') {
    throw registrationDenied()
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, normalized))
    .limit(1)
  if (existing) {
    return
  }

  const [invite] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(sql`lower(${invitation.email})`, normalized),
        isNull(invitation.acceptedAt),
        gt(invitation.expiresAt, new Date()),
        proof?.passwordSignup
          ? eq(invitation.token, proof.invitationToken as string)
          : undefined,
      ),
    )
    .limit(1)
  if (invite) {
    return
  }

  throw registrationDenied()
}

function registrationDenied() {
  return new APIError('FORBIDDEN', {
    code: 'REGISTRATION_NOT_ALLOWED',
    message: m.auth_registration_not_allowed(),
  })
}
