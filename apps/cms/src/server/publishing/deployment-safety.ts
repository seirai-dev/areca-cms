import { and, eq, inArray, or } from 'drizzle-orm'

import type { db } from '#/db'
import { buildJob, site } from '#/db/schema'
import { ConflictError } from '#/server/content/errors'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Callers hold the organization and/or site mutation lock before checking.
export async function assertSiteHasNoPendingDeployment(
  tx: Transaction,
  siteId: string,
) {
  const pending = (await tx
    .select({ id: buildJob.id })
    .from(buildJob)
    .where(and(eq(buildJob.siteId, siteId), pendingDeployment()))
    .limit(1)).at(0)
  if (pending)
    throw new ConflictError(
      'Finish or cancel pending releases and reconcile uncertain deployments before deleting this site',
    )
}

export async function assertOrganizationHasNoPendingDeployment(
  tx: Transaction,
  organizationId: string,
) {
  const pending = (await tx
    .select({ id: buildJob.id })
    .from(buildJob)
    .innerJoin(site, eq(site.id, buildJob.siteId))
    .where(and(eq(site.organizationId, organizationId), pendingDeployment()))
    .limit(1)).at(0)
  if (pending)
    throw new ConflictError(
      'Finish or cancel pending releases and reconcile uncertain deployments before changing the Dokploy connection',
    )
}

function pendingDeployment() {
  return or(
    inArray(buildJob.status, ['queued', 'building', 'validating', 'deploying']),
    eq(buildJob.dispatchUncertain, true),
  )
}
