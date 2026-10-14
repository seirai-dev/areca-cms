import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'

import { db } from '#/db'
import {
  auditLog,
  collection,
  entry,
  membership,
  organization,
  site,
  user,
} from '#/db/schema'
import type { EntryData, Field } from '#/lib/types'
import { assertAdminMfa, requireUser } from '#/lib/session.server'

const loose = { strict: { output: false } as const }

const SCHEDULED_LIMIT = 10
const ACTIVITY_LIMIT = 8

/**
 * Organizations the caller may see: `null` for agency admins (everything),
 * otherwise the organizations they are a member of. Mirrors the sites
 * overview so both halves of the home page are scoped the same way.
 */
async function accessibleOrgIds(userId: string, isAgencyAdmin: boolean) {
  if (isAgencyAdmin) return null
  const rows = await db
    .select({ organizationId: membership.organizationId })
    .from(membership)
    .where(eq(membership.userId, userId))
  return rows.map((row) => row.organizationId)
}

/** Entry titles live in the first text field; fall back to the slug. */
function entryTitleFrom(data: EntryData, fields: Field[], slug: string) {
  const textField = fields.find((field) => field.type === 'text')
  if (textField) {
    const value = data[textField.key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return slug
}

/**
 * The home page activity rail: what is about to go live and what just
 * happened. Scoped like the sites overview; editors see no audit trail.
 */
export const getHomeActivityFn = createServerFn({
  method: 'GET',
  ...loose,
}).handler(async () => {
  const session = await requireUser()
  const isAgencyAdmin = Boolean(session.user.isAgencyAdmin)
  if (isAgencyAdmin) assertAdminMfa(session.user)
  const orgIds = await accessibleOrgIds(session.user.id, isAgencyAdmin)
  if (orgIds && orgIds.length === 0) {
    return { scheduled: [], activity: [] }
  }
  const scope = orgIds ? inArray(site.organizationId, orgIds) : undefined

  const scheduledRows = await db
    .select({
      id: entry.id,
      slug: entry.slug,
      draftData: entry.draftData,
      scheduledAt: entry.scheduledAt,
      siteId: site.id,
      siteName: site.name,
      collectionKey: collection.key,
      collectionLabel: collection.label,
      collectionFields: collection.fields,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .innerJoin(site, eq(entry.siteId, site.id))
    .where(
      and(
        eq(entry.status, 'scheduled'),
        eq(collection.kind, 'collection'),
        isNotNull(entry.scheduledAt),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(asc(entry.scheduledAt))
    .limit(SCHEDULED_LIMIT)

  const scheduled = scheduledRows.map((row) => ({
    id: row.id,
    title: entryTitleFrom(row.draftData, row.collectionFields, row.slug),
    slug: row.slug,
    siteId: row.siteId,
    siteName: row.siteName,
    collectionKey: row.collectionKey,
    collectionLabel: row.collectionLabel,
    scheduledAt: row.scheduledAt,
  }))

  // Agency admins see every event, org owners only their own organizations,
  // editors none: the audit trail is not theirs to read.
  const ownerOrgIds = isAgencyAdmin
    ? null
    : (
        await db
          .select({ organizationId: membership.organizationId })
          .from(membership)
          .where(
            and(
              eq(membership.userId, session.user.id),
              eq(membership.role, 'owner'),
            ),
          )
      ).map((row) => row.organizationId)

  if (ownerOrgIds && ownerOrgIds.length === 0) {
    return { scheduled, activity: [] }
  }

  const activity = await db
    .select({
      id: auditLog.id,
      organizationId: auditLog.organizationId,
      organizationName: organization.name,
      siteId: auditLog.siteId,
      siteName: site.name,
      actorId: auditLog.actorId,
      actorName: user.name,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      meta: auditLog.meta,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.actorId, user.id))
    .leftJoin(organization, eq(auditLog.organizationId, organization.id))
    .leftJoin(site, eq(auditLog.siteId, site.id))
    .where(
      ownerOrgIds ? inArray(auditLog.organizationId, ownerOrgIds) : undefined,
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(ACTIVITY_LIMIT)

  return { scheduled, activity }
})
