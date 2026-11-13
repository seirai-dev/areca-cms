import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '#/lib/query-keys'
import {
  listMySessionsFn,
  revokeMyOtherSessionsFn,
  revokeMySessionFn,
} from '#/server/fn/account'

export function useAccountSessions() {
  return useQuery({
    queryKey: queryKeys.sessions(),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() }),
  })
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => revokeMyOtherSessionsFn(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() }),
  })
}
