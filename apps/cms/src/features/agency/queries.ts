import { queryOptions } from '@tanstack/react-query'

import { queryKeys } from '#/lib/query-keys'
import {
  getCloudflareCredentialStatusFn,
  getDokployCredentialStatusFn,
  listInvitationsFn,
  listOrganizationsFn,
  listPendingInvitationsFn,
  listSitesFn,
  listUsersFn,
} from '#/server/fn/admin'
import { getUserDetailFn } from '#/server/fn/people'
import { getHomeActivityFn } from '#/server/fn/home'

/**
 * Query options for the Agency workspace. Keys are shared with the rest of
 * the app (`queryKeys`, `sites-overview` from the shell) so every screen
 * reads and invalidates the same cache.
 */

export type ClientRow = Awaited<ReturnType<typeof listOrganizationsFn>>[number]
export type ClientSiteRow = Awaited<ReturnType<typeof listSitesFn>>[number]
export type AccountRow = Awaited<ReturnType<typeof listUsersFn>>[number]
export type PendingInvitationRow = Awaited<
  ReturnType<typeof listPendingInvitationsFn>
>[number]
export type PersonDetail = Awaited<ReturnType<typeof getUserDetailFn>>
export type HomeActivity = Awaited<ReturnType<typeof getHomeActivityFn>>

export function clientsQuery() {
  return queryOptions({
    queryKey: queryKeys.organizations(),
    queryFn: () => listOrganizationsFn(),
  })
}

export function clientSitesQuery(organizationId: string) {
  return queryOptions({
    queryKey: queryKeys.sites(organizationId),
    queryFn: () => listSitesFn({ data: { organizationId } }),
  })
}

export function accountsQuery() {
  return queryOptions({
    queryKey: queryKeys.users(),
    queryFn: () => listUsersFn(),
  })
}

/** Open invitations across every client, for the People list. */
export function pendingInvitationsQuery() {
  return queryOptions({
    queryKey: queryKeys.pendingInvitations(),
    queryFn: () => listPendingInvitationsFn(),
  })
}

/** One person's page: profile, sign-in state, clients and open invitations. */
export function personQuery(userId: string) {
  return queryOptions({
    queryKey: queryKeys.person(userId),
    queryFn: () => getUserDetailFn({ data: { userId } }),
  })
}

export function invitationsQuery(organizationId: string) {
  return queryOptions({
    queryKey: queryKeys.invitations(organizationId),
    queryFn: () => listInvitationsFn({ data: { organizationId } }),
  })
}

export function dokployStatusQuery(organizationId: string) {
  return queryOptions({
    queryKey: queryKeys.dokployCredentials(organizationId),
    queryFn: () => getDokployCredentialStatusFn({ data: { organizationId } }),
  })
}

export function cloudflareStatusQuery(organizationId: string) {
  return queryOptions({
    queryKey: queryKeys.cloudflareCredentials(organizationId),
    queryFn: () =>
      getCloudflareCredentialStatusFn({ data: { organizationId } }),
  })
}

export function homeActivityQuery() {
  return queryOptions({
    queryKey: queryKeys.homeActivity(),
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
