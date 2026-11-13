import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { queryKeys } from '#/lib/query-keys'
import {
  dismissPausedJobFn,
  listPausedJobsFn,
  retryPausedJobFn,
} from '#/server/fn/paused-jobs'
import type { PausedKind } from '#/server/ops/paused-jobs'
import { m } from '#/paraglide/messages'

export function usePausedJobs() {
  return useQuery({
    queryKey: queryKeys.pausedJobs(),
    queryFn: () => listPausedJobsFn(),
  })
}

export type PausedJobAction = 'retry' | 'dismiss'

/**
 * Retry or dismiss one paused item. The list is refreshed after either. An
 * item that stopped being paused in the meantime is reported, not an error.
 */
export function usePausedJobAction(action: PausedJobAction) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind: PausedKind; id: string }) =>
      action === 'retry'
        ? retryPausedJobFn({ data: input })
        : dismissPausedJobFn({ data: input }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pausedJobs() })
      if (!result.ok) {
        toast.error(m.agency_paused_gone())
        return
      }
      toast.success(
        action === 'retry'
          ? m.agency_paused_retried()
          : m.agency_paused_dismissed(),
      )
    },
    onError: () => {
      toast.error(m.agency_paused_error())
    },
  })
}
