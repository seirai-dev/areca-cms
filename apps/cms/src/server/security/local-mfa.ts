/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { and, eq, gt } from 'drizzle-orm'

import { db } from '#/db'
import { session, verification } from '#/db/schema'
import { env } from '#/env'
import { MfaRequiredError } from '#/lib/security-errors'

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
