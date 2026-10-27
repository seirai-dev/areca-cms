import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import { isDevSite } from '#/server/security/site-visibility'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

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

/** Locked re-read of a dev env inside a transaction. */
export async function lockDevEnvironment(
  tx: Tx,
  devSiteId: string,
): Promise<DevEnvRow> {
  const row = (
    await tx.select().from(site).where(eq(site.id, devSiteId)).for('update')
  ).at(0)
  if (!row || !isDevSite(row) || !row.parentSiteId) {
    throw new NotFoundError(m.server_site_not_found())
  }
  return { ...row, parentSiteId: row.parentSiteId }
}

/** Locked re-read of a production site inside a transaction. */
export async function lockProductionRow(
  tx: Tx,
  productionSiteId: string,
): Promise<SiteRow> {
  const row = (
    await tx
      .select()
      .from(site)
      .where(eq(site.id, productionSiteId))
      .for('update')
  ).at(0)
  if (!row) throw new NotFoundError(m.server_site_not_found())
  return row
}
