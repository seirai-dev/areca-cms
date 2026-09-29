import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { queryKeys } from '#/components/editor/query-keys'
import { errorMessage } from '#/components/editor/utils'
import { m } from '#/paraglide/messages'
import {
  cancelJobFn,
  requestPublicationFn,
  requestRollbackFn,
} from '#/server/fn/publishing'

const errorsKey = (siteId: string) => ['golive-errors', siteId] as const

/** Invalidate everything Go‑live reads for one site. */
export function useInvalidateGoLive(siteId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseStatus(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.publications(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.buildJobs(siteId) }),
      queryClient.invalidateQueries({ queryKey: ['golive-pending', siteId] }),
    ])
}

/**
 * Go live = `requestPublicationFn` (brief §1.2). Validation errors come back
 * as `{ ok: false, errors }`; they are kept in the query cache under
 * `golive-errors` so the tray and the panel show the same checklist.
 */
export function useGoLive(siteId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateGoLive(siteId)

  const errorsQuery = useQuery({
    queryKey: errorsKey(siteId),
    queryFn: () => [] as string[],
    initialData: [] as string[],
    staleTime: Infinity,
    enabled: false,
  })

  const mutation = useMutation({
    mutationKey: ['go-live', siteId],
    mutationFn: (options: { urgent?: boolean } = {}) =>
      requestPublicationFn({
        data: { siteId, priority: options.urgent ? 100 : undefined },
      }),
    onSuccess: async (result) => {
      if ('ok' in result && result.ok === false) {
        queryClient.setQueryData(errorsKey(siteId), result.errors)
        return
      }
      queryClient.setQueryData(errorsKey(siteId), [])
      toast.success(m.golive_toast_started(), {
        description: m.golive_toast_started_description(),
      })
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.golive_toast_failed())),
  })

  return {
    goLive: (options?: { urgent?: boolean }) => mutation.mutateAsync(options ?? {}),
    isPending: mutation.isPending,
    errors: errorsQuery.data,
    clearErrors: () => queryClient.setQueryData(errorsKey(siteId), []),
  }
}

/** Restore a previously live release ("Restore this version"). */
export function useRollback(siteId: string) {
  const invalidate = useInvalidateGoLive(siteId)
  return useMutation({
    mutationFn: (publicationId: string) =>
      requestRollbackFn({ data: { siteId, publicationId } }),
    onSuccess: async () => {
      toast.success(m.golive_toast_restore_started())
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.golive_toast_restore_failed())),
  })
}

/** Cancel a queued build job. */
export function useCancelJob(siteId: string) {
  const invalidate = useInvalidateGoLive(siteId)
  return useMutation({
    mutationFn: (jobId: string) => cancelJobFn({ data: { id: jobId } }),
    onSuccess: async () => {
      toast.success(m.sites_job_cancelled())
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_cancel_job_failed())),
  })
}
