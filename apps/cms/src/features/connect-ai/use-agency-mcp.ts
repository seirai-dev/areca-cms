import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'

import { queryKeys } from '#/lib/query-keys'
import { useStepUp } from '#/features/security/step-up'
import {
  createAgencyMcpKeyFn,
  listAgencyMcpKeysFn,
  revokeAgencyMcpKeyFn,
} from '#/server/fn/mcp-keys'
import {
  listAgencyMcpConnectionsFn,
  revokeAgencyMcpConnectionFn,
} from '#/server/fn/mcp-oauth'

import type { McpKeyInput } from './use-mcp-keys'

/**
 * The caller's personal agency keys and their mutations. Creating a key is a
 * privileged act, so it runs through the step-up dialog. Agency keys never
 * carry go-live, so the caller's flag is ignored by the server.
 */
export function useAgencyMcpKeys() {
  const queryClient = useQueryClient()
  const listKeys = useServerFn(listAgencyMcpKeysFn)
  const createKey = useServerFn(createAgencyMcpKeyFn)
  const revokeKey = useServerFn(revokeAgencyMcpKeyFn)
  const stepUp = useStepUp()

  const keys = useQuery({
    queryKey: queryKeys.agencyMcpKeys(),
    queryFn: () => listKeys(),
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.agencyMcpKeys() })

  const create = useMutation({
    mutationFn: (input: McpKeyInput) =>
      stepUp.run(() =>
        createKey({
          data: { name: input.name, expiresInDays: input.expiresInDays },
        }),
      ),
    onSettled: refresh,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeKey({ data: { id } }),
    onSettled: refresh,
  })

  return { keys, create, revoke }
}

/** The apps the caller connected to the agency connector, and revoke. */
export function useAgencyMcpConnections() {
  const queryClient = useQueryClient()
  const listConnections = useServerFn(listAgencyMcpConnectionsFn)
  const revokeConnection = useServerFn(revokeAgencyMcpConnectionFn)

  const connections = useQuery({
    queryKey: queryKeys.agencyMcpConnections(),
    queryFn: () => listConnections(),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeConnection({ data: { id } }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.agencyMcpConnections(),
      }),
  })

  return { connections, revoke }
}
