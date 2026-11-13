import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  listMySessionsFn,
  revokeMyOtherSessionsFn,
  revokeMySessionFn,
} from '#/server/fn/account'

export const SESSIONS_QUERY_KEY = ['account', 'sessions'] as const

export function useAccountSessions() {
  return useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () => listMySessionsFn(),
    staleTime: 0,
    retry: false,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) =>
      revokeMySessionFn({ data: { sessionId } }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  })
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => revokeMyOtherSessionsFn(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  })
}
