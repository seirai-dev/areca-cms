import { and, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { auditLog, user } from '#/db/schema'

export async function listAuditLog(input: {
  organizationId?: string
  siteId?: string
  limit: number
  offset: number
}) {
  const filters = []
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
      siteId: auditLog.siteId,
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
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(input.limit)
    .offset(input.offset)
}
