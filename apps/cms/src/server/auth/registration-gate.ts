import { APIError } from 'better-auth/api'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { db } from '#/db'
import { invitation, user } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { hashToken } from '#/server/security/token-hash'

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

  if (!(await isBootstrapped())) throw registrationDenied()
  if (!proof?.passwordSignup && !proof?.emailVerified)
    throw registrationDenied()
  if (proof.passwordSignup && typeof proof.invitationToken !== 'string') {
    throw registrationDenied()
  }

  if (await accountExists(normalized)) {
    return
  }

  if (
    await hasPendingInvitation(
      normalized,
      proof.passwordSignup ? proof.invitationToken : undefined,
    )
  ) {
    return
  }

  throw registrationDenied()
}

/**
 * Runs before Better Auth looks the email up, so an attacker cannot tell
 * "account exists" from "no invitation" by the sign-up response. Password
 * sign-up goes ahead only with a pending invitation for that email and no
 * account yet; every other outcome is the same refusal.
 */
export async function assertPasswordSignupMayProceed(
  email: unknown,
  invitationToken: unknown,
) {
  if (typeof email !== 'string' || typeof invitationToken !== 'string') {
    throw registrationDenied()
  }
  const normalized = email.trim().toLowerCase()
  if (!(await isBootstrapped())) throw registrationDenied()
  if (await accountExists(normalized)) throw registrationDenied()
  if (!(await hasPendingInvitation(normalized, invitationToken))) {
    throw registrationDenied()
  }
}

async function isBootstrapped() {
  // An empty instance is bootstrapped only by token-authorized setup.
  const [anyUser] = await db.select({ id: user.id }).from(user).limit(1)
  return Boolean(anyUser)
}

async function accountExists(normalizedEmail: string) {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, normalizedEmail))
    .limit(1)
  return Boolean(existing)
}

/** `token` narrows the match to one invitation link (password sign-up). */
async function hasPendingInvitation(normalizedEmail: string, token: unknown) {
  const [invite] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(sql`lower(${invitation.email})`, normalizedEmail),
        isNull(invitation.acceptedAt),
        gt(invitation.expiresAt, new Date()),
        typeof token === 'string'
          ? eq(invitation.tokenHash, hashToken(token))
          : undefined,
      ),
    )
    .limit(1)
  return Boolean(invite)
}

function registrationDenied() {
  return new APIError('FORBIDDEN', {
    code: 'REGISTRATION_NOT_ALLOWED',
    message: m.auth_registration_not_allowed(),
  })
}
