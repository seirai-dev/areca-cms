import { and, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { auditLog, organization, site, user } from '#/db/schema'
import { clientVisibleAuditFilter } from '#/server/security/site-visibility'

export async function listAuditLog(input: {
  organizationId?: string
  siteId?: string
  limit: number
  offset: number
  /** Agency admins see development environment rows; everyone else does not. */
  includeDevEnvs?: boolean
}) {
  const filters = []
  if (!input.includeDevEnvs) {
    filters.push(clientVisibleAuditFilter())
  }
  if (input.organizationId) {
    filters.push(eq(auditLog.organizationId, input.organizationId))
  }
  if (input.siteId) {
    filters.push(eq(auditLog.siteId, input.siteId))
  }

  return db
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
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(input.limit)
    .offset(input.offset)
}
