/**
 * Changing your own sign-in address (agency admins, see `assertMayChangeEmail`
 * in lib/auth.ts). Better Auth signs the confirmation link; this module keeps
 * the one change each person has pending, so that:
 *
 * - only the latest request can be confirmed, and only once;
 * - a password reset or change cancels it (`cancelPendingEmailChange`);
 * - confirming re-checks the person is still an unblocked agency admin and
 *   that nobody took the address in the meantime;
 * - the confirmation mail can be rendered again on a retry (the link is
 *   derived from the pending row, never stored).
 */
import { and, eq, gt, ne, notLike, or, sql } from 'drizzle-orm'
import { createEmailVerificationToken } from 'better-auth/api'
import { verifyJWT } from 'better-auth/crypto'

import { db } from '#/db'
import { session, user, verification } from '#/db/schema'
import { env } from '#/env'

/** As long as Better Auth's verification link (`emailVerification.expiresIn`). */
export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60

/** Where the confirmation link returns; `error=<code>` is added on failure. */
export const EMAIL_CHANGE_CALLBACK = '/account?emailChange=done'

const pendingId = (userId: string) => `email-change:${userId}`

/** Replaces any earlier pending change: only the latest link can be used. */
export async function recordPendingEmailChange(
  userId: string,
  newEmail: string,
  now: Date = new Date(),
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, pendingId(userId)))
    await tx.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: pendingId(userId),
      value: newEmail.toLowerCase(),
      expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_SECONDS * 1000),
      createdAt: now,
      updatedAt: now,
    })
  })
}

/** The address this person asked to move to, while the request is live. */
export async function pendingEmailChange(
  userId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const row = (
    await db
      .select({ value: verification.value })
      .from(verification)
      .where(
        and(
          eq(verification.identifier, pendingId(userId)),
          gt(verification.expiresAt, now),
        ),
      )
      .limit(1)
  ).at(0)
  return row?.value ?? null
}

export async function cancelPendingEmailChange(userId: string) {
  await db
    .delete(verification)
    .where(eq(verification.identifier, pendingId(userId)))
}

/**
 * The confirmation link for the pending change, built when the mail is
 * rendered (also on a retry). Null when the request was replaced, cancelled
 * or has expired, so a stale retry never sends a link.
 */
export async function emailChangeLink(userId: string, newEmail: string) {
  const pending = await pendingEmailChange(userId)
  if (pending !== newEmail.toLowerCase()) return null
  const current = (
    await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  if (!current) return null
  // The same claims Better Auth puts in its own change link.
  const token = await createEmailVerificationToken(
    env.BETTER_AUTH_SECRET,
    current.email.toLowerCase(),
    pending,
    EMAIL_CHANGE_TTL_SECONDS,
    { requestType: 'change-email-verification', userId },
  )
  const base = env.BETTER_AUTH_URL.replace(/\/$/, '')
  return {
    token,
    url: `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(EMAIL_CHANGE_CALLBACK)}`,
  }
}

/** Who a verify-email token moves where, if it is an email change link. */
export async function emailChangeTarget(
  token: unknown,
): Promise<{ userId: string; newEmail: string } | null> {
  if (typeof token !== 'string' || !token) return null
  const payload = await verifyJWT<Record<string, unknown>>(
    token,
    env.BETTER_AUTH_SECRET,
  )
  if (
    payload?.requestType !== 'change-email-verification' ||
    typeof payload.userId !== 'string' ||
    typeof payload.updateTo !== 'string'
  ) {
    return null
  }
  return { userId: payload.userId, newEmail: payload.updateTo.toLowerCase() }
}

export type EmailChangeRefusal =
  'EMAIL_CHANGE_CANCELLED' | 'EMAIL_CHANGE_NOT_ALLOWED' | 'EMAIL_TAKEN'

/** Why a confirmation must not apply now, or null when it may. */
export async function emailChangeRefusal(
  userId: string,
  newEmail: string,
): Promise<EmailChangeRefusal | null> {
  if ((await pendingEmailChange(userId)) !== newEmail.toLowerCase()) {
    return 'EMAIL_CHANGE_CANCELLED'
  }
  const person = (
    await db
      .select({ isAgencyAdmin: user.isAgencyAdmin, blockedAt: user.blockedAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  if (!person?.isAgencyAdmin || person.blockedAt) {
    return 'EMAIL_CHANGE_NOT_ALLOWED'
  }
  // The unique index compares exact values; addresses are compared lowercased.
  const taken = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        sql`lower(${user.email}) = ${newEmail.toLowerCase()}`,
        ne(user.id, userId),
      ),
    )
    .limit(1)
  return taken.length > 0 ? 'EMAIL_TAKEN' : null
}

/**
 * After the address moved: the pending row is used up, every other session
 * ends (as after a password change), and links already mailed to the old
 * address stop working. Those are Better Auth's hashed one-time tokens for
 * this person (password reset); hashed identifiers never contain `:`, the
 * app's own plain markers (`step-up:`, `local-mfa:`) always do and stay.
 */
export async function finishEmailChange(
  userId: string,
  keepSessionId: string | null,
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, pendingId(userId)))
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, userId),
          or(
            notLike(verification.identifier, '%:%'),
            sql`${verification.identifier} like 'reset-password:%'`,
          ),
        ),
      )
    await tx
      .delete(session)
      .where(
        keepSessionId
          ? and(eq(session.userId, userId), ne(session.id, keepSessionId))
          : eq(session.userId, userId),
      )
  })
}
