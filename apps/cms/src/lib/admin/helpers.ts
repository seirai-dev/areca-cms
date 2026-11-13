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
