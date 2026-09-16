import { APIError } from 'better-auth/api'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { db } from '#/db'
import { invitation, user } from '#/db/schema'
import { m } from '#/paraglide/messages'

/**
 * Registration is invite-only, whatever the sign-in method. A brand new user
 * row may only be created when:
 *
 * - no accounts exist yet (the one-time /setup bootstrap), or
 * - a pending, unexpired invitation exists for that email.
 *
 * Someone who already has an account never reaches this: Better Auth links the
 * social/SSO account to the existing user instead of creating a second one.
 */
export async function assertEmailMayRegister(email: string) {
  const normalized = email.trim().toLowerCase()

  const [anyUser] = await db.select({ id: user.id }).from(user).limit(1)
  if (!anyUser) {
    return
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
      ),
    )
    .limit(1)
  if (invite) {
    return
  }

  throw new APIError('FORBIDDEN', {
    code: 'REGISTRATION_NOT_ALLOWED',
    message: m.auth_registration_not_allowed(),
  })
}
