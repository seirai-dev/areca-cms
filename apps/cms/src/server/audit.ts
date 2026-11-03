import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { auditLog, site } from '#/db/schema'
import { isDevSite } from '#/lib/site-environment'
import type { AuditMeta } from '#/lib/types'

import { currentAuditContext } from './audit-context.ts'

type AuditConnection = Pick<typeof db, 'insert' | 'select'>

/**
 * `knownSite` is the site row the caller already loaded for `siteId`. When it
 * is given, the agency-only check reads it instead of selecting the site again.
 */
export async function audit(
  input: {
    /** Null for instance-level events that belong to no organization. */
    organizationId: string | null
    siteId?: string | null
    actorId?: string | null
    action: string
    targetType: string
    targetId: string
    meta?: AuditMeta
  },
  connection: AuditConnection = db,
  knownSite?: { id: string; environment: string },
) {
  await connection.insert(auditLog).values({
    organizationId: input.organizationId,
    siteId: input.siteId ?? null,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    meta: mergeMeta(input.meta),
    agencyOnly: await isAgencyOnlyAudit(input, connection, knownSite),
  })
}

/**
 * Rows only agency admins may read (docs/design/dev-environments.md,
 * Decision 22): anything written for a development environment, and every
 * `dev_env.*` action, which names the dev env in its target or meta. The flag
 * is stored, so the rows stay hidden after the dev env and its `site_id` are
 * deleted.
 */
async function isAgencyOnlyAudit(
  input: { siteId?: string | null; action: string },
  connection: AuditConnection,
  knownSite: { id: string; environment: string } | undefined,
): Promise<boolean> {
  if (input.action.startsWith('dev_env.')) return true
  if (!input.siteId) return false
  if (knownSite && knownSite.id === input.siteId) return isDevSite(knownSite)
  const row = (
    await connection
      .select({ environment: site.environment })
      .from(site)
      .where(eq(site.id, input.siteId))
      .limit(1)
  ).at(0)
  return row ? isDevSite(row) : false
}

function mergeMeta(meta: AuditMeta | undefined): AuditMeta | null {
  const context = currentAuditContext()
  if (!context) return meta ?? null
  return { ...context, ...meta }
}
