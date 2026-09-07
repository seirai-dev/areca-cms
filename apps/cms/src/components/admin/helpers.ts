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
]

export const adminQueryKeys = {
  organizations: ['organizations'] as const,
  sites: (organizationId: string) => ['sites', organizationId] as const,
  site: (id: string) => ['site', id] as const,
  members: (organizationId: string) => ['members', organizationId] as const,
  invitations: (organizationId: string) =>
    ['invitations', organizationId] as const,
  users: ['users'] as const,
  audit: (offset: number) => ['audit', offset] as const,
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
