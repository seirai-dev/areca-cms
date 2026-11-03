import { eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import {
  collection,
  entry,
  entryRevision,
  mcpConnection,
  mcpKey,
  site,
} from '#/db/schema'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { assetExclusiveLock } from '#/server/assets/usage'

import { lockProductionSite } from './lock'
import {
  lockDevEnvironment,
  lockProductionRow,
  readDevEnvironment,
} from './rows'
import type { DevEnvActor, Tx } from './rows'

/**
 * Deletes a dev env's entry revisions, entries and collections. Nothing is
 * archived: dev content is a throwaway sandbox (Decision 6). The site row,
 * tokens and preview URL are left alone, so a reset can reuse them.
 */
export async function deleteDevContent(tx: Tx, devSiteId: string) {
  const devEntries = tx
    .select({ id: entry.id })
    .from(entry)
    .where(eq(entry.siteId, devSiteId))
  await tx
    .delete(entryRevision)
    .where(inArray(entryRevision.entryId, devEntries))
  await tx.delete(entry).where(eq(entry.siteId, devSiteId))
  await tx.delete(collection).where(eq(collection.siteId, devSiteId))
}

/**
 * Everything a dev env owns, then its site row. Used by delete and by
 * `deleteSite` on the production site, inside that transaction. Other rows
 * that reference the site (publications, build jobs, notifications, the
 * scheduler backoff) cascade or are set null by the foreign keys.
 */
export async function deleteDevSiteRows(tx: Tx, devSiteId: string) {
  await deleteDevContent(tx, devSiteId)
  await tx.delete(mcpKey).where(eq(mcpKey.siteId, devSiteId))
  await tx.delete(mcpConnection).where(eq(mcpConnection.siteId, devSiteId))
  await tx.delete(site).where(eq(site.id, devSiteId))
}

/**
 * Deletes a development environment (Decision 6: no fresh step-up, no
 * archive). Audited on the production site.
 */
export async function deleteDevEnvironment(
  actor: DevEnvActor,
  devSiteId: string,
) {
  const probe = await readDevEnvironment(devSiteId)
  await db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, probe.organizationId, {
      mode: 'no-key-update',
    })
    const dev = await lockDevEnvironment(tx, devSiteId)
    const prod = await lockProductionRow(tx, dev.parentSiteId)
    await lockProductionSite(tx, prod.id)
    // The lock ordinary entry saves take, last in the order (see push.ts): the
    // delete below must not wait on a revision a save holds, or the reverse.
    await assetExclusiveLock(tx, probe.organizationId)
    await audit(
      {
        organizationId: prod.organizationId,
        siteId: prod.id,
        actorId: actor.id,
        action: 'dev_env.delete',
        targetType: 'site',
        targetId: dev.id,
        meta: { slug: dev.slug },
      },
      tx,
    )
    await deleteDevSiteRows(tx, dev.id)
  })
}
