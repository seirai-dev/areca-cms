import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor } from '#/db'
import { auditLog, site } from '#/db/schema'
import { isDevSite } from '#/lib/site-environment'
import type { AuditMeta } from '#/lib/types'

import { currentAuditContext } from './audit-context.ts'

/**
 * Autosaves by one person on one entry this close together share one
 * `entry.update` row. Matches the activity feed's repeat window, so the feed
 * groups them as it did when every autosave had its own row.
 */
export const AUTOSAVE_AUDIT_WINDOW_MS = 15 * 60_000

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
  connection: DbExecutor = db,
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
 * The `entry.update` row of an autosave. When the entry's newest audit row is
 * this person's autosave row within the window, that row counts the save
 * (`meta.saves`, `meta.firstSavedAt`) and moves to now; otherwise a new row
 * starts with `saves: 1`. Writes inside an audit context (MCP) always add
 * their own row. Callers hold the site's link-index lock, so two saves of one
 * entry never race here.
 */
export async function auditAutosave(
  input: {
    organizationId: string
    siteId: string
    actorId: string
    entryId: string
  },
  connection: DbExecutor = db,
  knownSite?: { id: string; environment: string },
) {
  const row = {
    organizationId: input.organizationId,
    siteId: input.siteId,
    actorId: input.actorId,
    action: 'entry.update',
    targetType: 'entry',
    targetId: input.entryId,
  }
  if (currentAuditContext()) {
    await audit(row, connection, knownSite)
    return
  }
  const coalesced = await connection.execute(sql`
    with latest as (
      select ${auditLog.id} as id, ${auditLog.action} as action,
        ${auditLog.actorId} as actor_id, ${auditLog.meta} as meta,
        ${auditLog.createdAt} as created_at
      from ${auditLog}
      where ${auditLog.targetId} = ${input.entryId}
        and ${auditLog.targetType} = 'entry'
      order by ${auditLog.createdAt} desc, ${auditLog.id} desc
      limit 1
    )
    update ${auditLog}
    set created_at = now(),
      meta = latest.meta || jsonb_build_object(
        'saves', (latest.meta->>'saves')::int + 1,
        'firstSavedAt', coalesce(latest.meta->'firstSavedAt', to_jsonb(latest.created_at))
      )
    from latest
    where ${auditLog.id} = latest.id
      and latest.action = 'entry.update'
      and latest.actor_id = ${input.actorId}
      and jsonb_typeof(latest.meta->'saves') = 'number'
      and latest.created_at >= now() - make_interval(secs => ${AUTOSAVE_AUDIT_WINDOW_MS / 1000})
    returning ${auditLog.id}
  `)
  if (coalesced.rows.length > 0) return
  await audit({ ...row, meta: { saves: 1 } }, connection, knownSite)
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
  connection: DbExecutor,
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
