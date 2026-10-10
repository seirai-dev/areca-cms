import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'

import {
  listMcpConnectionsFn,
  revokeMcpConnectionFn,
} from '#/server/fn/mcp-oauth'

export function mcpConnectionsQueryKey(siteId: string) {
  return ['connect-ai', 'connections', siteId] as const
}

/** The apps connected to a site (via OAuth) and the connector URL. */
export function useMcpConnections(siteId: string) {
  const queryClient = useQueryClient()
  const listConnections = useServerFn(listMcpConnectionsFn)
  const revokeConnection = useServerFn(revokeMcpConnectionFn)

  const connections = useQuery({
    queryKey: mcpConnectionsQueryKey(siteId),
    queryFn: () => listConnections({ data: { siteId } }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeConnection({ data: { id } }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: mcpConnectionsQueryKey(siteId),
      }),
  })

  return { connections, revoke }
}
