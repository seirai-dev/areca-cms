import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import type { MyNotifications, RulesMatrix } from '#/lib/notifications'
import {
  getAgencyNotificationRulesFn,
  getMyNotificationsFn,
  getOrgNotificationRulesFn,
  setAgencyNotificationRuleFn,
  setMyNotificationFn,
  setOrgNotificationRuleFn,
} from '#/server/fn/notifications'

import {
  applyAgencyRuleChange,
  applyPreferenceChange,
  applyRuleChange,
} from './notification-rules-logic'
import type {
  OrgRuleChange,
  PreferenceChange,
  RuleChange,
} from './notification-rules-logic'

export const myNotificationsQueryKey = ['notifications', 'mine'] as const
export const orgRulesQueryKey = (organizationId: string) =>
  ['notifications', 'org-rules', organizationId] as const
export const agencyRulesQueryKey = ['notifications', 'agency-rules'] as const

type OrgRules = RulesMatrix & { orgName: string; agencyName: string }
type AgencyRules = { clients: RulesMatrix; agency: RulesMatrix }

/**
 * Optimistic save for one rule matrix. The cell changes at once; the server's
 * matrix replaces it when it answers, and a failure restores the snapshot and
 * shows the reason.
 */
function useRuleSave<T, TChange extends RuleChange>({
  queryKey,
  apply,
  save,
}: {
  queryKey: QueryKey
  apply: (data: T, change: TChange) => T
  save: (change: TChange) => Promise<Partial<T>>
}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: save,
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<T>(queryKey)
      if (previous) {
        queryClient.setQueryData<T>(queryKey, apply(previous, change))
      }
      return { previous }
    },
    onError: (error, _change, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      toast.error(errorMessage(error))
    },
    onSuccess: (result) => {
      queryClient.setQueryData<T>(queryKey, (current) =>
        current ? { ...current, ...result } : current,
      )
    },
  })
}

/** An organization's rules, for its owners and agency admins. */
export function useOrgNotificationRules(organizationId: string) {
  const queryKey = orgRulesQueryKey(organizationId)
  const query = useQuery({
    queryKey,
    queryFn: () => getOrgNotificationRulesFn({ data: { organizationId } }),
  })
  const save = useRuleSave<OrgRules, OrgRuleChange>({
    queryKey,
    apply: applyRuleChange,
    save: (change) =>
      setOrgNotificationRuleFn({ data: { organizationId, ...change } }),
  })
  const mutate = save.mutate
  const setRule = React.useCallback(
    (change: OrgRuleChange) => mutate(change),
    [mutate],
  )
  return { query, setRule }
}

/** Agency defaults: the client matrix and the agency alerts matrix. */
export function useAgencyNotificationRules() {
  const query = useQuery({
    queryKey: agencyRulesQueryKey,
    queryFn: () => getAgencyNotificationRulesFn(),
  })
  const save = useRuleSave<AgencyRules, RuleChange>({
    queryKey: agencyRulesQueryKey,
    apply: applyAgencyRuleChange,
    save: (change) => setAgencyNotificationRuleFn({ data: change }),
  })
  const mutate = save.mutate
  const setRule = React.useCallback(
    (change: RuleChange) => mutate(change),
    [mutate],
  )
  return { query, setRule }
}

/** The signed-in person's own switches, grouped by organization. */
export function useMyNotifications() {
  return useQuery({
    queryKey: myNotificationsQueryKey,
    queryFn: () => getMyNotificationsFn(),
  })
}

/**
 * Account → Notifications. The server answers a refused change (a locked
 * event) with `ok: false`; that is thrown so the switch snaps back.
 */
export function useSetMyNotification() {
  const queryClient = useQueryClient()
  const queryKey = myNotificationsQueryKey
  return useMutation({
    mutationFn: async (change: PreferenceChange) => {
      const result = await setMyNotificationFn({ data: change })
      if (!result.ok) throw new Error(result.message)
    },
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<MyNotifications>(queryKey)
      if (previous) {
        queryClient.setQueryData<MyNotifications>(
          queryKey,
          applyPreferenceChange(previous, change),
        )
      }
      return { previous }
    },
    onError: (error, _change, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      toast.error(errorMessage(error))
    },
  })
}
