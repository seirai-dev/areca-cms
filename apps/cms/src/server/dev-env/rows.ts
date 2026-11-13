import { eq } from 'drizzle-orm'

import { db } from '#/db'
import type { Tx } from '#/db'
import { site } from '#/db/schema'
import { isDevSite } from '#/server/security/site-visibility'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'

export type SiteRow = typeof site.$inferSelect

/** The actor who runs a development-environment action (a user id for audit). */
export type DevEnvActor = { id: string }

/** A dev env row, with its production parent. */
export type DevEnvRow = SiteRow & { parentSiteId: string }

/**
 * Reads a development environment by id, without a lock. Used only to find
 * the organization to lock; the locked re-read is done in the transaction.
 * Anything that is not a dev env is NotFound, so production sites never
 * answer to these calls.
 */
export async function readDevEnvironment(
  devSiteId: string,
): Promise<DevEnvRow> {
  const row = (
    await db.select().from(site).where(eq(site.id, devSiteId)).limit(1)
  ).at(0)
  if (!row || !isDevSite(row) || !row.parentSiteId) {
    throw new NotFoundError(m.server_site_not_found())
  }
  return { ...row, parentSiteId: row.parentSiteId }
}

/**
 * Locked re-read of a dev env inside a transaction. `FOR NO KEY UPDATE`, not
 * `FOR UPDATE`: the audit insert of an ordinary save needs KEY SHARE on this row
 * while it holds the asset lock, and FOR UPDATE would deadlock with it
 * (docs/design/dev-environments.md, "Locking and concurrency").
 */
export async function lockDevEnvironment(
  tx: Tx,
  devSiteId: string,
): Promise<DevEnvRow> {
  const row = (
    await tx
      .select()
      .from(site)
      .where(eq(site.id, devSiteId))
      .for('no key update')
  ).at(0)
  if (!row || !isDevSite(row) || !row.parentSiteId) {
    throw new NotFoundError(m.server_site_not_found())
  }
  return { ...row, parentSiteId: row.parentSiteId }
}

/**
 * Locked re-read of a production site inside a transaction, `FOR NO KEY UPDATE`
 * for the same reason as `lockDevEnvironment`. Used by dev-env paths and the
 * production slug change, which takes the dev-env lock for its dev rename.
 */
export async function lockProductionRow(
  tx: Tx,
  productionSiteId: string,
): Promise<SiteRow> {
  const row = (
    await tx
      .select()
      .from(site)
      .where(eq(site.id, productionSiteId))
      .for('no key update')
  ).at(0)
  if (!row) throw new NotFoundError(m.server_site_not_found())
  return row
}
