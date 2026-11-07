import { db } from '#/db'
import { entry, environmentPush } from '#/db/schema'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { assetExclusiveLock } from '#/server/assets/usage'
import { eq } from 'drizzle-orm'

import { copyProductionIntoDev } from './fork'
import type { DevEnvCounts } from './fork'
import { lockProductionSite } from './lock'
import { deleteDevContent } from './delete'
import {
  lockSiteLinkIndex,
  rebuildEntryLinkIndex,
} from '#/server/content/entry-link-index'
import {
  lockDevEnvironment,
  lockProductionRow,
  readDevEnvironment,
} from './rows'
import type { DevEnvActor } from './rows'

export type RefreshResult = DevEnvCounts & { discardedEntries: number }

/**
 * Reset from production (Decision 6): throws away everything in the dev env
 * and forks again. The site row, tokens, name and preview URL stay. Agency
 * admins only, no step-up. Unpushed dev changes are discarded, not archived.
 */
export async function refreshDevEnvironment(
  actor: DevEnvActor,
  devSiteId: string,
): Promise<RefreshResult> {
  const probe = await readDevEnvironment(devSiteId)
  return db.transaction(async (tx) => {
    // Link-index lock first: this reset deletes and rewrites the dev env's entries
    // and their link rows (see `lockSiteLinkIndex`).
    await lockSiteLinkIndex(tx, devSiteId)
    await lockOrganizationForMutation(tx, probe.organizationId, {
      mode: 'no-key-update',
    })
    const dev = await lockDevEnvironment(tx, devSiteId)
    const prod = await lockProductionRow(tx, dev.parentSiteId)
    await lockProductionSite(tx, prod.id)
    // The lock ordinary entry saves take, last in the order (see push.ts). A
    // save holding it is never waiting on a revision this reset deletes.
    await assetExclusiveLock(tx, probe.organizationId)

    const discarded = (
      await tx
        .select({ id: entry.id })
        .from(entry)
        .where(eq(entry.siteId, dev.id))
    ).length
    await deleteDevContent(tx, dev.id)
    const counts = await copyProductionIntoDev(tx, prod, dev, actor.id)
    // The dev environment's entries were rewritten: rebuild its link index.
    await rebuildEntryLinkIndex(tx, dev.id)
    await tx.insert(environmentPush).values({
      devSiteId: dev.id,
      productionSiteId: prod.id,
      kind: 'refresh',
      actorId: actor.id,
      counts,
      items: [],
    })
    await audit(
      {
        organizationId: prod.organizationId,
        siteId: prod.id,
        actorId: actor.id,
        action: 'dev_env.refresh',
        targetType: 'site',
        targetId: dev.id,
        meta: { slug: dev.slug, ...counts, discardedEntries: discarded },
      },
      tx,
    )
    return { ...counts, discardedEntries: discarded }
  })
}
