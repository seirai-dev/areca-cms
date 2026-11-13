import { and, eq, inArray, or } from 'drizzle-orm'

import type { DbReader, Tx } from '#/db'
import { buildJob, site } from '#/db/schema'
import { ACTIVE_JOB_STATUSES } from '#/lib/job-status'
import { ConflictError } from '#/server/content/errors'

/** Whether a site has a release queued, running, or with an uncertain dispatch. */
export async function siteHasPendingDeployment(
  executor: DbReader,
  siteId: string,
) {
  const pending = (
    await executor
      .select({ id: buildJob.id })
      .from(buildJob)
      .where(and(eq(buildJob.siteId, siteId), pendingDeployment()))
      .limit(1)
  ).at(0)
  return Boolean(pending)
}

// Callers hold the organization and/or site mutation lock before checking.
export async function assertSiteHasNoPendingDeployment(
  tx: Tx,
  siteId: string,
  action = 'deleting this site',
) {
  if (await siteHasPendingDeployment(tx, siteId))
    throw new ConflictError(
      `Finish or cancel pending releases and reconcile uncertain deployments before ${action}`,
    )
}

export async function assertOrganizationHasNoPendingDeployment(
  tx: Tx,
  organizationId: string,
  connection = 'the Dokploy connection',
) {
  const pending = (
    await tx
      .select({ id: buildJob.id })
      .from(buildJob)
      .innerJoin(site, eq(site.id, buildJob.siteId))
      .where(and(eq(site.organizationId, organizationId), pendingDeployment()))
      .limit(1)
  ).at(0)
  if (pending)
    throw new ConflictError(
      `Finish or cancel pending releases and reconcile uncertain deployments before changing ${connection}`,
    )
}

function pendingDeployment() {
  return or(
    inArray(buildJob.status, ACTIVE_JOB_STATUSES),
    eq(buildJob.dispatchUncertain, true),
  )
}
