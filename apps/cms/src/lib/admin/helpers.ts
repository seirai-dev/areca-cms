import type { FieldType, MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'

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

export function membershipRoleLabel(role: MembershipRole) {
  return role === 'owner' ? m.admin_role_owner() : m.admin_role_editor()
}

export const adminQueryKeys = {
  organizations: ['organizations'] as const,
  dokployCredentials: (organizationId: string) =>
    ['dokploy-credentials', organizationId] as const,
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
  return m.admin_error_generic()
}

export function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const AUDIT_ACTION_LABELS: Partial<Record<string, () => string>> = {
  'organization.create': () => m.admin_audit_action_organization_create(),
  'organization.dokploy_credentials_created': () =>
    m.admin_audit_action_organization_dokploy_credentials_created(),
  'organization.dokploy_credentials_removed': () =>
    m.admin_audit_action_organization_dokploy_credentials_removed(),
  'organization.dokploy_credentials_updated': () =>
    m.admin_audit_action_organization_dokploy_credentials_updated(),
  'organization.dokploy_credentials_validation_failed': () =>
    m.admin_audit_action_organization_dokploy_credentials_validation_failed(),
  'organization.dokploy_credentials_verified': () =>
    m.admin_audit_action_organization_dokploy_credentials_verified(),
  'organization.update': () => m.admin_audit_action_organization_update(),
  'site.create': () => m.admin_audit_action_site_create(),
  'site.update': () => m.admin_audit_action_site_update(),
  'site.rotate_token': () => m.admin_audit_action_site_rotate_token(),
  'site.delete': () => m.admin_audit_action_site_delete(),
  'member.invite': () => m.admin_audit_action_member_invite(),
  'member.update_role': () => m.admin_audit_action_member_update_role(),
  'member.remove': () => m.admin_audit_action_member_remove(),
  'invitation.revoke': () => m.admin_audit_action_invitation_revoke(),
  'invitation.accept': () => m.admin_audit_action_invitation_accept(),
  'entry.create': () => m.admin_audit_action_entry_create(),
  'entry.update': () => m.admin_audit_action_entry_update(),
  'entry.restore': () => m.admin_audit_action_entry_restore(),
  'entry.publish': () => m.admin_audit_action_entry_publish(),
  'entry.unpublish': () => m.admin_audit_action_entry_unpublish(),
  'entry.archive': () => m.admin_audit_action_entry_archive(),
  'entry.schedule': () => m.admin_audit_action_entry_schedule(),
  'entry.cancel_schedule': () => m.admin_audit_action_entry_cancel_schedule(),
  'entry.delete': () => m.admin_audit_action_entry_delete(),
  'manifest.sync': () => m.admin_audit_action_manifest_sync(),
  'collection.upsert': () => m.admin_audit_action_collection_upsert(),
  'collection.delete': () => m.admin_audit_action_collection_delete(),
  'publication.requested': () => m.admin_audit_action_publication_requested(),
  'publication.rollback_requested': () =>
    m.admin_audit_action_publication_rollback_requested(),
  'publication.live': () => m.admin_audit_action_publication_live(),
  'publication.failed': () => m.admin_audit_action_publication_failed(),
  'publication.scheduled_failed': () =>
    m.admin_audit_action_publication_scheduled_failed(),
  'build_job.cancelled': () => m.admin_audit_action_build_job_cancelled(),
}

export function formatAuditAction(action: string) {
  const label = AUDIT_ACTION_LABELS[action]
  if (label) {
    return label()
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
