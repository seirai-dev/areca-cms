import { db } from '#/db'
import { auditLog } from '#/db/schema'
import type { AuditMeta } from '#/lib/types'

import { currentAuditContext } from './audit-context.ts'

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
  connection: Pick<typeof db, 'insert'> = db,
) {
  await connection.insert(auditLog).values({
    organizationId: input.organizationId,
    siteId: input.siteId ?? null,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    meta: mergeMeta(input.meta),
  })
}

function mergeMeta(meta: AuditMeta | undefined): AuditMeta | null {
  const context = currentAuditContext()
  if (!context) return meta ?? null
  return { ...context, ...meta }
}
