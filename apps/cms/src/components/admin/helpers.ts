import type { FieldType } from '#/lib/types'

export const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'richtext',
  'image',
  'date',
  'datetime',
  'select',
  'reference',
  'slug',
  'boolean',
  'number',
  'url',
]

export const adminQueryKeys = {
  organizations: ['organizations'] as const,
  sites: (organizationId: string) => ['sites', organizationId] as const,
  site: (id: string) => ['site', id] as const,
  members: (organizationId: string) => ['members', organizationId] as const,
  invitations: (organizationId: string) =>
    ['invitations', organizationId] as const,
  users: ['users'] as const,
  audit: (offset: number, organizationId?: string) =>
    ['audit', organizationId ?? 'all', offset] as const,
  collections: (siteId: string) => ['collections', siteId] as const,
}

export function errorMessage(err: unknown) {
  if (err instanceof Error && err.message) {
    return err.message
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string' &&
    err.message
  ) {
    return err.message
  }
  return 'Something went wrong'
}

export function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'organization.create': 'Created organization',
  'organization.update': 'Updated organization',
  'site.create': 'Created site',
  'site.update': 'Updated site',
  'site.rotate_token': 'Rotated site token',
  'site.delete': 'Deleted site',
  'member.invite': 'Sent invitation',
  'member.update_role': 'Updated member role',
  'member.remove': 'Removed member',
  'invitation.revoke': 'Revoked invitation',
  'invitation.accept': 'Accepted invitation',
  'entry.create': 'Created entry',
  'entry.update': 'Updated entry',
  'entry.restore': 'Restored revision',
  'entry.publish': 'Published entry',
  'entry.unpublish': 'Unpublished entry',
  'entry.archive': 'Archived entry',
  'entry.schedule': 'Scheduled entry',
  'entry.cancel_schedule': 'Cancelled schedule',
  'entry.delete': 'Deleted entry',
  'manifest.sync': 'Synced manifest',
  'collection.upsert': 'Saved collection',
  'publication.requested': 'Requested publication',
  'publication.rollback_requested': 'Requested rollback',
  'publication.live': 'Publication went live',
  'publication.failed': 'Publication failed',
  'publication.scheduled_failed': 'Scheduled publish failed',
  'build_job.cancelled': 'Cancelled build job',
}

export function formatAuditAction(action: string) {
  if (AUDIT_ACTION_LABELS[action]) {
    return AUDIT_ACTION_LABELS[action]
  }
  return action.replace(/[._]/g, ' ')
}

export function formatAuditTarget(row: {
  targetType: string
  targetId: string
  organizationName?: string | null
  siteName?: string | null
  meta?: unknown
}) {
  const meta =
    row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : null
  if (typeof meta?.slug === 'string' && meta.slug) {
    return `${row.targetType} “${meta.slug}”`
  }
  if (typeof meta?.email === 'string' && meta.email) {
    return `${row.targetType} ${meta.email}`
  }
  if (typeof meta?.collectionKey === 'string' && meta.collectionKey) {
    return `${row.targetType} ${meta.collectionKey}`
  }
  if (row.targetType === 'organization' && row.organizationName) {
    return row.organizationName
  }
  if (row.targetType === 'site' && row.siteName) {
    return row.siteName
  }
  return row.targetType
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return '—'
  }
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return date.toLocaleString()
}
