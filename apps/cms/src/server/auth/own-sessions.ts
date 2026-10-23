import { and, desc, eq, gt } from 'drizzle-orm'

import { db } from '#/db'
import { session } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { ForbiddenError, NotFoundError } from '#/server/content/errors'

/**
 * One of the signed-in person's sessions, as the Sessions page shows it. The
 * token is deliberately absent: the page names a session by its id, and the
 * server looks the token up when it revokes.
 */
export type OwnSession = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  current: boolean
}

/** The user's live sessions, most recently active first. */
export async function listOwnSessions(
  userId: string,
  currentSessionId: string,
): Promise<OwnSession[]> {
  const rows = await db
    .select({
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt))
  return rows.map((row) => ({ ...row, current: row.id === currentSessionId }))
}

/**
 * The token of another live session of the same user, for Better Auth to
 * revoke. The current session is refused: it ends through sign-out. A session
 * that belongs to someone else, or has expired, answers NotFound like a
 * missing id, so session ids cannot be probed.
 */
export async function revocableOwnSessionToken(
  userId: string,
  currentSessionId: string,
  sessionId: string,
): Promise<string> {
  if (sessionId === currentSessionId) {
    throw new ForbiddenError(m.server_session_is_current())
  }
  const rows = await db
    .select({ token: session.token })
    .from(session)
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.userId, userId),
        gt(session.expiresAt, new Date()),
      ),
    )
    .limit(1)
  const row = rows.at(0)
  if (!row) throw new NotFoundError()
  return row.token
}
