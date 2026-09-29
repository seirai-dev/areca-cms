import { queryOptions } from '@tanstack/react-query'

import { adminQueryKeys } from '#/components/admin/helpers'
import {
  getDokployCredentialStatusFn,
  listInvitationsFn,
  listOrganizationsFn,
  listSitesFn,
  listUsersFn,
} from '#/server/fn/admin'
import { getHomeActivityFn } from '#/server/fn/home'

/**
 * Query options for the Agency workspace. Keys are shared with the rest of
 * the app (`adminQueryKeys`, `sites-overview` from the shell) so every screen
 * reads and invalidates the same cache.
 */

export type ClientRow = Awaited<ReturnType<typeof listOrganizationsFn>>[number]
export type ClientSiteRow = Awaited<ReturnType<typeof listSitesFn>>[number]
export type AccountRow = Awaited<ReturnType<typeof listUsersFn>>[number]
export type HomeActivity = Awaited<ReturnType<typeof getHomeActivityFn>>

export function clientsQuery() {
  return queryOptions({
    queryKey: adminQueryKeys.organizations,
    queryFn: () => listOrganizationsFn(),
  })
}

export function clientSitesQuery(organizationId: string) {
  return queryOptions({
    queryKey: adminQueryKeys.sites(organizationId),
    queryFn: () => listSitesFn({ data: { organizationId } }),
  })
}

export function accountsQuery() {
  return queryOptions({
    queryKey: adminQueryKeys.users,
    queryFn: () => listUsersFn(),
  })
}

export function invitationsQuery(organizationId: string) {
  return queryOptions({
    queryKey: adminQueryKeys.invitations(organizationId),
    queryFn: () => listInvitationsFn({ data: { organizationId } }),
  })
}

export function dokployStatusQuery(organizationId: string) {
  return queryOptions({
    queryKey: adminQueryKeys.dokployCredentials(organizationId),
    queryFn: () => getDokployCredentialStatusFn({ data: { organizationId } }),
  })
}

export function homeActivityQuery() {
  return queryOptions({
    queryKey: ['home-activity'] as const,
    queryFn: () => getHomeActivityFn(),
    staleTime: 15_000,
  })
}

/** Up to two initials for a client tile: "Northwind Studio" → "NS". */
export function clientInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? parts[0].charAt(0) + parts[1].charAt(0)
      : (parts[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}
