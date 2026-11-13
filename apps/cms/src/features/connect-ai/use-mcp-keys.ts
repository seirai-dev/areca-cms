import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'

import { queryKeys } from '#/lib/query-keys'
import { useStepUp } from '#/features/security/step-up'
import {
  createMcpKeyFn,
  listMcpKeysFn,
  revokeMcpKeyFn,
} from '#/server/fn/mcp-keys'

export type McpKeyInput = {
  name: string
  expiresInDays: 30 | 90 | 365 | null
  allowGoLive: boolean
}

/** The site's AI keys plus the mutations behind the Connect AI page. */
export function useMcpKeys(siteId: string) {
  const queryClient = useQueryClient()
  const listKeys = useServerFn(listMcpKeysFn)
  const createKey = useServerFn(createMcpKeyFn)
  const revokeKey = useServerFn(revokeMcpKeyFn)
  const stepUp = useStepUp()

  const keys = useQuery({
    queryKey: queryKeys.mcpKeys(siteId),
    queryFn: () => listKeys({ data: { siteId } }),
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.mcpKeys(siteId) })

  // Agency admins may need a fresh second factor, so creation goes through
  // the step-up dialog (the same flow the other privileged screens use).
  const create = useMutation({
    mutationFn: (input: McpKeyInput) =>
      stepUp.run(() => createKey({ data: { siteId, ...input } })),
    onSettled: refresh,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeKey({ data: { id } }),
    onSettled: refresh,
  })

  return { keys, create, revoke }
}
