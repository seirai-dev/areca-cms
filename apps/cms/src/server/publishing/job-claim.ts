import { and, eq, inArray, sql } from 'drizzle-orm'

import { db, pool } from '#/db'
import type { Tx } from '#/db'
import { buildJob, publication, site } from '#/db/schema'
import { env } from '#/env'
import {
  RUNNING_JOB_STATUSES,
  RUNNING_JOB_STATUSES_SQL,
} from '#/lib/job-status'
import { siteCoreColumns } from '#/server/content/site-core'

import { deploymentIdentity } from './publications.ts'

// Legacy active/uncertain rows may predate resource keys. Resolve their frozen
// target (or prior site target) so new releases cannot bypass their quarantine.
const fallbackConnectionUrl =
  process.env.NODE_ENV !== 'production' &&
  env.DOKPLOY_DEV_FALLBACK_ENABLED &&
  env.DOKPLOY_URL
    ? new URL(env.DOKPLOY_URL).href.replace(/\/+$/, '')
    : null

/**
 * SQL test for a Dokploy target. Rows written before the provider field existed
 * have no `provider`, which means Dokploy. Only these rows may get a legacy key
 * built from the Dokploy connection URL and the application ID.
 */
function dokployTargetSql(target: string) {
  return `coalesce(${target}->>'provider', 'dokploy') = 'dokploy'`
}

export function resourceBlockerSql(fallbackUrl: string | null) {
  const fallbackLiteral =
    fallbackUrl === null ? 'NULL' : `'${fallbackUrl.replaceAll("'", "''")}'`
  return `
SELECT 1 FROM build_job a
JOIN site legacy_site ON legacy_site.id=a.site_id
LEFT JOIN dokploy_credential credential ON credential.organization_id=legacy_site.organization_id
WHERE a.id<>q.id AND (a.status IN (${RUNNING_JOB_STATUSES_SQL}) OR a.dispatch_uncertain)
AND coalesce(a.deployment_resource_key,
  CASE WHEN coalesce(a.dispatch_connection_url, credential.url, ${fallbackLiteral}) IS NOT NULL
  AND ${dokployTargetSql('coalesce(a.dispatch_target, legacy_site.deployment_target)')}
  THEN encode(sha256(convert_to(rtrim(coalesce(a.dispatch_connection_url, credential.url, ${fallbackLiteral}), '/') || E'\\n' || (coalesce(a.dispatch_target, legacy_site.deployment_target)->>'applicationId'), 'UTF8')), 'hex') END
)=q.deployment_resource_key
`
}
const RESOURCE_BLOCKER_SQL = resourceBlockerSql(fallbackConnectionUrl)

export const CLAIM_SQL = `
WITH candidate_site AS (
  SELECT s.id FROM site s
  WHERE EXISTS (SELECT 1 FROM build_job q WHERE q.site_id=s.id AND q.status='queued'
    AND (q.deployment_resource_key IS NULL OR NOT EXISTS (${RESOURCE_BLOCKER_SQL})))
    AND NOT EXISTS (SELECT 1 FROM build_job a WHERE a.site_id=s.id AND (a.status IN (${RUNNING_JOB_STATUSES_SQL}) OR a.dispatch_uncertain))
  ORDER BY (SELECT max(priority) FROM build_job q WHERE q.site_id=s.id AND q.status='queued') DESC, s.id
  LIMIT 1 FOR UPDATE OF s SKIP LOCKED
), candidate_job AS (
  SELECT q.id FROM build_job q JOIN candidate_site s ON s.id=q.site_id
  WHERE q.status='queued' AND (q.deployment_resource_key IS NULL OR NOT EXISTS (${RESOURCE_BLOCKER_SQL}))
  ORDER BY q.priority DESC, q.created_at ASC LIMIT 1 FOR UPDATE OF q SKIP LOCKED
)
UPDATE build_job SET status='building', started_at=now(), lease_expires_at=now()+interval '60 seconds', attempts=attempts+1
WHERE id=(SELECT id FROM candidate_job) RETURNING *
`

export const LEASE_MS = 60_000

export type BuildJob = typeof buildJob.$inferSelect

export async function claimNextJob() {
  await pool.query(
    `UPDATE build_job j SET
    dispatch_target=coalesce(j.dispatch_target,s.deployment_target),
    dispatch_connection_url=coalesce(j.dispatch_connection_url,c.url,$1::text),
    deployment_resource_key=encode(sha256(convert_to(rtrim(coalesce(j.dispatch_connection_url,c.url,$1::text), '/') || E'\\n' || (coalesce(j.dispatch_target,s.deployment_target)->>'applicationId'), 'UTF8')), 'hex')
    FROM site s LEFT JOIN dokploy_credential c ON c.organization_id=s.organization_id,
      publication p
    WHERE j.site_id=s.id AND j.publication_id=p.id AND p.publishing_mode='production'
      AND j.status='queued' AND j.deployment_resource_key IS NULL
      AND coalesce(j.dispatch_target,s.deployment_target)->>'applicationId' IS NOT NULL
      AND ${dokployTargetSql('coalesce(j.dispatch_target,s.deployment_target)')}
      AND coalesce(j.dispatch_connection_url,c.url,$1::text) IS NOT NULL`,
    [fallbackConnectionUrl],
  )
  let result
  try {
    result = await pool.query<{ id: string }>(CLAIM_SQL)
  } catch (error) {
    // Two sites can race for one upstream resource; the unique index is the
    // final database fence. Leave the losing job queued for the next tick.
    if (
      (error as { code?: string; constraint?: string }).code === '23505' &&
      (error as { constraint?: string }).constraint ===
        'build_job_one_dispatch_per_resource'
    )
      return null
    throw error
  }
  const id = result.rows[0]?.id
  if (!id) return null
  const job = (
    await db.select().from(buildJob).where(eq(buildJob.id, id)).limit(1)
  ).at(0)
  return job ?? null
}

/** Serializes claims on one site. Always the first lock of a claim. */
export async function lockSiteRow(tx: Tx, siteId: string) {
  await tx.execute(sql`SELECT id FROM site WHERE id=${siteId} FOR UPDATE`)
}

/** Whether a worker currently holds a job of this site. */
export async function siteHasRunningJob(tx: Tx, siteId: string) {
  const running = await tx
    .select({ id: buildJob.id })
    .from(buildJob)
    .where(
      and(
        eq(buildJob.siteId, siteId),
        inArray(buildJob.status, RUNNING_JOB_STATUSES),
      ),
    )
    .limit(1)
  return running.length > 0
}

/**
 * Freezes the job's upstream identity, then takes the advisory lock on its
 * resource and checks for another dispatch to it. Called after `lockSiteRow`:
 * the order is site lock, advisory lock, blocker check.
 */
export async function lockDeploymentResource(tx: Tx, job: BuildJob) {
  const identity = await resourceIdentity(tx, job)
  const resourceKey =
    identity.deploymentResourceKey ?? job.deploymentResourceKey
  if (!resourceKey) return { identity, resourceKey, blocked: false }
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceKey}, 2))`,
  )
  const blocked = await tx.execute(
    sql`SELECT 1 FROM (SELECT ${job.id}::text id, ${resourceKey}::text deployment_resource_key) q WHERE EXISTS (${sql.raw(RESOURCE_BLOCKER_SQL)})`,
  )
  return { identity, resourceKey, blocked: blocked.rows.length > 0 }
}

/** The columns that hand a job to this worker with a fresh lease. */
export function leaseColumns(
  identity: Awaited<ReturnType<typeof resourceIdentity>>,
  status: 'building' | 'deploying',
) {
  return {
    ...identity,
    status,
    startedAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    attempts: sql`${buildJob.attempts}+1`,
  }
}

async function resourceIdentity(tx: Tx, job: BuildJob) {
  if (job.deploymentResourceKey) return {}
  const existingSite = (
    await tx.select(siteCoreColumns).from(site).where(eq(site.id, job.siteId))
  ).at(0)
  const pub = (
    await tx
      .select({ publishingMode: publication.publishingMode })
      .from(publication)
      .where(eq(publication.id, job.publicationId))
  ).at(0)
  if (!existingSite || !pub) return {}
  return deploymentIdentity(tx, {
    ...existingSite,
    publishingMode: pub.publishingMode,
    deploymentTarget: job.dispatchTarget ?? existingSite.deploymentTarget,
  })
}
