import { db } from '#/db'
import { auditLog } from '#/db/schema'
import type { AuditMeta } from '#/lib/types'

export async function audit(input: {
  organizationId: string
  siteId?: string | null
  actorId?: string | null
  action: string
  targetType: string
  targetId: string
  meta?: AuditMeta
}) {
  await db.insert(auditLog).values({
    organizationId: input.organizationId,
    siteId: input.siteId ?? null,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    meta: input.meta ?? null,
  })
}
