/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { and, eq } from 'drizzle-orm'
import { verifyPassword } from 'better-auth/crypto'

import { db } from '#/db'
import { account } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { ForbiddenError } from '#/server/content/errors'
import { allowUserAction } from '#/server/http/rate-limit.server'
import { verifyStepUp } from '#/server/security/verify-step-up'

/** Guesses at the password or code before the account is locked for a while. */
const SELF_DELETE_RULE = { limit: 5, windowSeconds: 15 * 60 } as const

/**
 * Re-verifies the person before their account is deleted: the password when
 * the account has one, otherwise a second-factor code when two-factor is on.
 * SSO-only accounts without two-factor pass on the typed email alone (checked
 * by the caller). Throws ForbiddenError when the proof is missing or wrong.
 */
export async function verifySelfDeletion(input: {
  userId: string
  twoFactorEnabled: boolean
  session: { id: string; createdAt: Date }
  password?: string
  code?: string
  kind?: 'totp' | 'backup'
  headers: Headers
}) {
  const [credential] = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, 'credential'),
      ),
    )
    .limit(1)
  if (credential?.password) {
    if (!input.password) {
      throw new ForbiddenError(m.server_self_delete_password_required())
    }
    if (
      !(await allowUserAction('self-delete', input.userId, SELF_DELETE_RULE))
    ) {
      throw new ForbiddenError(m.server_self_delete_rate_limited())
    }
    const matches = await verifyPassword({
      hash: credential.password,
      password: input.password,
    })
    if (!matches) {
      throw new ForbiddenError(m.server_self_delete_password_wrong())
    }
    return
  }
  if (input.twoFactorEnabled) {
    if (!input.code) {
      throw new ForbiddenError(m.server_self_delete_code_required())
    }
    await verifyStepUp({
      session: input.session,
      userId: input.userId,
      code: input.code,
      kind: input.kind,
      headers: input.headers,
    })
  }
}
