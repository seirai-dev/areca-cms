import { useQueries, useQuery } from '@tanstack/react-query'

import { sitesOverviewQueryOptions } from '#/components/shell/workspace-switcher'

import { accountsQuery, clientsQuery, invitationsQuery } from './queries'

export type StepKey = 'client' | 'site' | 'connect' | 'invite' | 'live'

/** Where a step's action goes. Resolved to a Link by the checklist. */
export type StepTarget =
  | { kind: 'new-client' }
  | { kind: 'new-site'; orgId: string | null }
  | { kind: 'developer'; siteId: string }
  | { kind: 'people'; orgId: string }
  | { kind: 'go-live'; siteId: string }

export type Step = {
  key: StepKey
  done: boolean
  /** Missing while an earlier step has to happen first. */
  target: StepTarget | null
}

/**
 * The Agency first-run checklist (brief §3.11), computed from real data:
 *
 * 1. Create a client        any client exists
 * 2. Add a site             any site exists
 * 3. Connect the project    a site has collections
 * 4. Invite the client      someone without agency access is a member, or an
 *                           invitation is still pending
 * 5. Go live                any site is live
 */
export function useGettingStarted() {
  const clients = useQuery(clientsQuery())
  const overview = useQuery(sitesOverviewQueryOptions())
  const accounts = useQuery(accountsQuery())

  const clientRows = clients.data ?? []
  const sites = overview.data?.sites ?? []
  const hasMember = (accounts.data ?? []).some(
    (account) => !account.isAgencyAdmin && account.memberships.length > 0,
  )

  // Pending invitations only matter while nobody has joined yet; the
  // per-client lists share the People screens' cache.
  const needInvites = accounts.isSuccess && !hasMember
  const invites = useQueries({
    queries: clientRows.slice(0, 20).map((client) => ({
      ...invitationsQuery(client.id),
      enabled: needInvites,
    })),
  })
  const now = Date.now()
  const hasPendingInvite = invites.some((result) =>
    (result.data ?? []).some(
      (invite) =>
        !invite.acceptedAt && new Date(invite.expiresAt).getTime() > now,
    ),
  )

  const loading = clients.isPending || overview.isPending || accounts.isPending
  const firstClient = clientRows[0]
  const withoutCollections = sites.find((site) => site.collections === 0)
  const connected = sites.find((site) => site.collections > 0)

  const steps: Step[] = [
    {
      key: 'client',
      done: clientRows.length > 0,
      target: { kind: 'new-client' },
    },
    {
      key: 'site',
      done: sites.length > 0,
      target:
        clientRows.length > 0
          ? {
              kind: 'new-site',
              orgId: clientRows.length === 1 ? firstClient.id : null,
            }
          : null,
    },
    {
      key: 'connect',
      done: Boolean(connected),
      target: sites[0]
        ? { kind: 'developer', siteId: (withoutCollections ?? sites[0]).id }
        : null,
    },
    {
      key: 'invite',
      done: hasMember || hasPendingInvite,
      target:
        clientRows.length > 0
          ? {
              kind: 'people',
              orgId: sites[0]?.organizationId ?? firstClient.id,
            }
          : null,
    },
    {
      key: 'live',
      done: sites.some((site) => site.live),
      target: sites[0]
        ? { kind: 'go-live', siteId: (connected ?? sites[0]).id }
        : null,
    },
  ]

  const doneCount = steps.filter((step) => step.done).length
  return {
    steps,
    loading,
    doneCount,
    complete: !loading && doneCount === steps.length,
    current: steps.find((step) => !step.done)?.key ?? null,
  }
}
