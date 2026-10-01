import { and, eq, gt } from 'drizzle-orm'

import { db } from '#/db'
import { verification } from '#/db/schema'
import { ReauthRequiredError } from '#/lib/security-errors'
import { STEP_UP_WINDOW_MS, isFresh } from '#/lib/step-up'

/** Consecutive wrong codes allowed before step-up locks for the lockout. */
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

const markerId = (sessionId: string) => `step-up:${sessionId}`
const failureId = (userId: string) => `step-up-failures:${userId}`

type StepUpSession = {
  session: { id: string; createdAt: Date }
  user: { id: string; twoFactorEnabled?: boolean | null }
}

/**
 * Step-up gate for the most sensitive admin actions. The session must have
 * been created (sign-in, including its two-factor challenge) or re-verified
 * with a TOTP code (`recordStepUp`) in the last ten minutes, otherwise the
 * caller gets `REAUTH_REQUIRED` and the UI asks for a code and retries.
 *
 * Users without two-factor have no second factor to re-enter; the admin
 * guard already refuses them unless enforcement is switched off, so the
 * check is skipped for them instead of locking the action forever.
 */
export async function assertFreshSession(
  session: StepUpSession,
  now: Date = new Date(),
) {
  if (!session.user.twoFactorEnabled) return
  if (isFresh([session.session.createdAt], now)) return

  const [marker] = await db
    .select({ createdAt: verification.createdAt })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, markerId(session.session.id)),
        gt(verification.expiresAt, now),
      ),
    )
    .limit(1)
  if (isFresh([marker?.createdAt], now)) return

  throw new ReauthRequiredError()
}

/** Remember that this session just re-verified a second factor. */
export async function recordStepUp(
  sessionId: string,
  userId: string,
  now: Date = new Date(),
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, markerId(sessionId)))
    await tx.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: markerId(sessionId),
      value: userId,
      expiresAt: new Date(now.getTime() + STEP_UP_WINDOW_MS),
      createdAt: now,
      updatedAt: now,
    })
  })
}

async function failureCount(userId: string, now: Date) {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, failureId(userId)),
        gt(verification.expiresAt, now),
      ),
    )
    .limit(1)
  return row ? Number(row.value) || 0 : 0
}

/** True while too many wrong codes have been entered for this user. */
export async function isStepUpLocked(userId: string, now: Date = new Date()) {
  return (await failureCount(userId, now)) >= MAX_FAILED_ATTEMPTS
}

export async function recordStepUpFailure(
  userId: string,
  now: Date = new Date(),
) {
  const count = (await failureCount(userId, now)) + 1
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, failureId(userId)))
    await tx.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: failureId(userId),
      value: String(count),
      expiresAt: new Date(now.getTime() + LOCKOUT_MS),
      createdAt: now,
      updatedAt: now,
    })
  })
}

export async function clearStepUpFailures(userId: string) {
  await db
    .delete(verification)
    .where(eq(verification.identifier, failureId(userId)))
}
