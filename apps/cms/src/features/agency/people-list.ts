import type { MembershipRole } from '#/lib/types'

/**
 * Filters for `/agency/people`. They live in the URL (`?status=&role=&client=&q=`),
 * so the logic stays pure and the screen only wires it to the router.
 */
export const STATUS_FILTERS = [
  'all',
  'active',
  'blocked',
  'invited',
  'two-factor-off',
] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

export const ROLE_FILTERS = ['all', 'agency-admin', 'owner', 'editor'] as const
export type RoleFilter = (typeof ROLE_FILTERS)[number]

export const ALL_CLIENTS = 'all'

export type PeopleFilters = {
  search: string
  status: StatusFilter
  role: RoleFilter
  clientId: string
}

export const DEFAULT_PEOPLE_FILTERS: PeopleFilters = {
  search: '',
  status: 'all',
  role: 'all',
  clientId: ALL_CLIENTS,
}

/** The subset of a people row the filters read. */
export type PeopleAccount = {
  id: string
  name: string
  email: string
  status: 'active' | 'blocked'
  isAgencyAdmin: boolean
  twoFactorEnabled: boolean
  memberships: Array<{ organizationId: string; role: MembershipRole }>
}

/** The subset of a pending invitation the filters read. */
export type PeopleInvitation = {
  id: string
  email: string
  organizationId: string
  role: MembershipRole
}

function matchesSearch(filters: PeopleFilters, fields: string[]) {
  const needle = filters.search.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) => field.toLowerCase().includes(needle))
}

/** People with an account that match every filter. */
export function filterAccounts<T extends PeopleAccount>(
  accounts: T[],
  filters: PeopleFilters,
): T[] {
  // Invitations are their own rows; the Invited filter shows only those.
  if (filters.status === 'invited') return []
  return accounts.filter((account) => {
    if (filters.status === 'active' && account.status !== 'active') return false
    if (filters.status === 'blocked' && account.status !== 'blocked') {
      return false
    }
    if (filters.status === 'two-factor-off' && account.twoFactorEnabled) {
      return false
    }
    if (!matchesSearch(filters, [account.name, account.email])) return false
    const inClient =
      filters.clientId === ALL_CLIENTS
        ? account.memberships
        : account.memberships.filter(
            (item) => item.organizationId === filters.clientId,
          )
    if (filters.clientId !== ALL_CLIENTS && inClient.length === 0) return false
    if (filters.role === 'all') return true
    if (filters.role === 'agency-admin') return account.isAgencyAdmin
    return inClient.some((item) => item.role === filters.role)
  })
}

/**
 * Pending invitations that match. They have no agency-admin flag and no
 * account, so the admin filter hides them and the search reads the email.
 */
export function filterInvitations<T extends PeopleInvitation>(
  invitations: T[],
  filters: PeopleFilters,
): T[] {
  if (filters.status !== 'all' && filters.status !== 'invited') return []
  if (filters.role === 'agency-admin') return []
  return invitations.filter((invitation) => {
    if (!matchesSearch(filters, [invitation.email])) return false
    if (
      filters.clientId !== ALL_CLIENTS &&
      invitation.organizationId !== filters.clientId
    ) {
      return false
    }
    if (filters.role === 'owner' || filters.role === 'editor') {
      return invitation.role === filters.role
    }
    return true
  })
}

/**
 * Counts for the status pills. They ignore search, role and client, so the
 * pills always say how many people are in each state. "All" counts accounts
 * and invitations together; "2FA off" overlaps with the others.
 */
export function countByStatus(
  accounts: PeopleAccount[],
  invitations: PeopleInvitation[],
): Record<StatusFilter, number> {
  return {
    all: accounts.length + invitations.length,
    active: accounts.filter((item) => item.status === 'active').length,
    blocked: accounts.filter((item) => item.status === 'blocked').length,
    invited: invitations.length,
    'two-factor-off': accounts.filter((item) => !item.twoFactorEnabled).length,
  }
}

/** Parses an untrusted search string into filters, falling back to defaults. */
export function parsePeopleFilters(input: {
  q?: unknown
  status?: unknown
  role?: unknown
  client?: unknown
}): PeopleFilters {
  return {
    search: typeof input.q === 'string' ? input.q : '',
    status: STATUS_FILTERS.includes(input.status as StatusFilter)
      ? (input.status as StatusFilter)
      : 'all',
    role: ROLE_FILTERS.includes(input.role as RoleFilter)
      ? (input.role as RoleFilter)
      : 'all',
    clientId:
      typeof input.client === 'string' && input.client !== ''
        ? input.client
        : ALL_CLIENTS,
  }
}

/** True when any filter narrows the list (drives "Clear filters"). */
export function hasActiveFilters(filters: PeopleFilters) {
  return (
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.role !== 'all' ||
    filters.clientId !== ALL_CLIENTS
  )
}
