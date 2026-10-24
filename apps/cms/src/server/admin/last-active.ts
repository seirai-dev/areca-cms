import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { auditLog, session, user } from '#/db/schema'

/** Raw `max(timestamptz)` values come back as text, so read them as dates. */
function asDate(value: unknown): Date | null {
  return value ? new Date(String(value)) : null
}

/**
 * "Last active", for every person, as one subquery (`userId`, `at`): the later
 * of their newest session update and their newest sign-in audit row. Sessions
 * end when a person signs out or is blocked, so the sign-in row is what keeps
 * "last active" from reading "never" for them. The people list joins it, and
 * the person page filters it to one user, so both always agree.
 */
export function lastActiveSubquery() {
  const lastSession = db
    .select({
      userId: session.userId,
      at: sql<Date | null>`max(${session.updatedAt})`
        .mapWith(asDate)
        .as('session_at'),
    })
    .from(session)
    .groupBy(session.userId)
    .as('last_session')

  const lastSignIn = db
    .select({
      userId: auditLog.actorId,
      at: sql<Date | null>`max(${auditLog.createdAt})`
        .mapWith(asDate)
        .as('sign_in_at'),
    })
    .from(auditLog)
    .where(eq(auditLog.action, 'user.sign_in'))
    .groupBy(auditLog.actorId)
    .as('last_sign_in')

  return db
    .select({
      userId: user.id,
      at: sql<Date | null>`greatest(${lastSession.at}, ${lastSignIn.at})`
        .mapWith(asDate)
        .as('last_active_at'),
    })
    .from(user)
    .leftJoin(lastSession, eq(lastSession.userId, user.id))
    .leftJoin(lastSignIn, eq(lastSignIn.userId, user.id))
    .as('last_active')
}
