import type { FieldType, MembershipRole } from '#/lib/types'
import { stripSecurityCode } from '#/lib/security-errors'
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
  devEnvironment: (siteId: string) => ['dev-environment', siteId] as const,
  pushPlan: (devSiteId: string) => ['push-plan', devSiteId] as const,
  devSync: (devSiteId: string) => ['dev-sync', devSiteId] as const,
  members: (organizationId: string) => ['members', organizationId] as const,
  invitations: (organizationId: string) =>
    ['invitations', organizationId] as const,
  users: ['users'] as const,
  person: (userId: string) => ['person', userId] as const,
  pendingInvitations: ['pending-invitations'] as const,
  audit: (offset: number, organizationId?: string) =>
    ['audit', organizationId ?? 'all', offset] as const,
  collections: (siteId: string) => ['collections', siteId] as const,
}

export function errorMessage(err: unknown) {
  if (err instanceof Error && err.message) {
    return stripSecurityCode(err.message)
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

/**
 * A slug as a readable title when no real title is at hand:
 * "poster-series-for-the-autumn-campaign" → "Poster series for the autumn
 * campaign".
 */
export function humanizeSlug(slug: string) {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
