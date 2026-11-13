/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { and, eq, gt } from 'drizzle-orm'

import { db } from '#/db'
import { session, verification } from '#/db/schema'
import { env } from '#/env'
import { MfaRequiredError } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'

type Principal = {
  session: { id: string }
  user: {
    id: string
    isAgencyAdmin?: boolean
    twoFactorEnabled?: boolean | null
  }
}

const proofId = (sessionId: string) => `local-mfa:${sessionId}`

/** A provider login or a newly created session is never a local factor proof. */
export async function localMfaVerifiedAt(
  principal: Principal,
  now = new Date(),
) {
  const [proof] = await db
    .select({ createdAt: verification.createdAt })
    .from(verification)
    .where(
      and(
        eq(verification.id, proofId(principal.session.id)),
        eq(verification.value, principal.user.id),
        gt(verification.expiresAt, now),
      ),
    )
    .limit(1)
  return proof?.createdAt ?? null
}

export async function requireAdminLocalMfa(principal: Principal) {
  if (!env.ADMIN_MFA_REQUIRED || !principal.user.isAgencyAdmin) return
  if (
    !principal.user.twoFactorEnabled ||
    !(await localMfaVerifiedAt(principal))
  ) {
    throw new MfaRequiredError()
  }
}

/**
 * Anyone else with two-factor on: this session must have passed a local TOTP
 * or backup code. Password sign-in does that in Better Auth's challenge;
 * social and SSO sign-ins skip it and meet it here. Agency admins are checked
 * by `requireAdminLocalMfa` instead.
 */
export async function requireMemberLocalMfa(principal: Principal) {
  if (principal.user.isAgencyAdmin || !principal.user.twoFactorEnabled) return
  if (!(await localMfaVerifiedAt(principal))) {
    throw new MfaRequiredError(m.server_mfa_verification_required())
  }
}

/** Both rules: the admin one for agency admins, the member one for everyone else. */
export async function requireLocalMfa(principal: Principal) {
  await requireAdminLocalMfa(principal)
  await requireMemberLocalMfa(principal)
}

/** Called only after Better Auth successfully verifies TOTP or a backup code. */
export async function recordLocalMfaForToken(token: string, now = new Date()) {
  const [verifiedSession] = await db
    .select()
    .from(session)
    .where(and(eq(session.token, token), gt(session.expiresAt, now)))
    .limit(1)
  if (!verifiedSession) return
  const id = proofId(verifiedSession.id)
  await db
    .insert(verification)
    .values({
      id,
      identifier: id,
      value: verifiedSession.userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: verifiedSession.expiresAt,
    })
    .onConflictDoUpdate({
      target: verification.id,
      set: {
        createdAt: now,
        updatedAt: now,
        expiresAt: verifiedSession.expiresAt,
      },
    })
}
