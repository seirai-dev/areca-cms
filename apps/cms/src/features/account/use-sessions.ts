import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authClient } from '#/lib/auth-client'

/** Better Auth's session APIs: list, revoke one, revoke the other sessions. */
export const SESSIONS_QUERY_KEY = ['account', 'sessions'] as const

export function useAccountSessions() {
  return useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async () => {
      const result = await authClient.listSessions()
      if (result.error) throw result.error
      return result.data
    },
    retry: false,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token })
      if (result.error) throw result.error
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  })
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions()
      if (result.error) throw result.error
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  })
}
