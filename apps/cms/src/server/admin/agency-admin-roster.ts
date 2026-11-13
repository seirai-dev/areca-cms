/**
 * The rule for the agency admin roster: who counts as an active admin, and the
 * lock that serialises every change to that set. Lives apart from the member
 * functions so the people functions and the member functions share one copy.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Tx } from '#/db'
import { user } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { ConflictError } from '#/server/content/errors'

/** The last active agency admin cannot be demoted, blocked or deleted. */
export class LastAgencyAdminError extends ConflictError {
  constructor() {
    super(m.server_cannot_remove_last_agency_admin())
    this.name = 'LastAgencyAdminError'
  }
}

/**
 * Takes the roster lock for the rest of the transaction. Every change that can
 * take an agency admin out of the active set (demote, block, delete, self
 * delete) takes it first, so two of them cannot both see the other as active.
 */
export async function lockAgencyAdminRoster(tx: Tx) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('agency-admin-roster', 0))`,
  )
}

/**
 * Agency admins who are not blocked. A blocked admin does not count as active.
 * A plain read, no row locks: every change that removes an admin takes
 * `lockAgencyAdminRoster` first, so a caller that holds it reads a settled
 * count, and a read-only caller (the account page) never blocks anyone.
 */
export async function countActiveAgencyAdmins(tx: Tx) {
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.isAgencyAdmin, true), isNull(user.blockedAt)))
  return rows.length
}

export function assertAgencyAdminCanBeRemoved(activeAdminCount: number) {
  if (activeAdminCount <= 1) {
    throw new LastAgencyAdminError()
  }
}
