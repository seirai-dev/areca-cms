import { sql } from 'drizzle-orm'

import type { Tx } from '#/db'

/**
 * Serializes every development-environment operation (fork, reset, delete,
 * and later push and copy) on one production site. Key 3 keeps it apart from
 * other advisory locks in the database. Released at commit or rollback.
 * Take it after the production row lock (docs/design/dev-environments.md,
 * "Locking and concurrency").
 */
export async function lockProductionSite(tx: Tx, productionSiteId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`dev-env:${productionSiteId}`}, 3))`,
  )
}
