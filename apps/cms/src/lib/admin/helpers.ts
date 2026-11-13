import { queryKeys } from '#/lib/query-keys'
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

/** @deprecated Use `queryKeys` from `#/lib/query-keys`. */
export const adminQueryKeys = {
  organizations: queryKeys.organizations(),
  dokployCredentials: queryKeys.dokployCredentials,
  cloudflareCredentials: queryKeys.cloudflareCredentials,
  sites: queryKeys.sites,
  site: queryKeys.site,
  devEnvironment: queryKeys.devEnvironment,
  pushPlan: queryKeys.pushPlan,
  devSync: queryKeys.devSync,
  members: queryKeys.members,
  invitations: queryKeys.invitations,
  users: queryKeys.users(),
  person: queryKeys.person,
  pendingInvitations: queryKeys.pendingInvitations(),
  audit: queryKeys.audit,
  collections: queryKeys.collections,
}

/** @deprecated Import `errorMessage` from `#/lib/errors`. */
export { errorMessage } from '#/lib/errors'

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
