import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'

import { publishingRequestIdentity } from './request-identity'

import { errorMessage } from '#/lib/errors'
import { queryKeys } from '#/lib/query-keys'
import { m } from '#/paraglide/messages'
import {
  cancelJobFn,
  reconcileDeploymentJobFn,
  resolveUncertainDeploymentJobFn,
  requestPublicationFn,
  requestRollbackFn,
} from '#/server/fn/publishing'

/**
 * Invalidate everything Go‑live reads for one site. `refetchType: 'none'`
 * only marks it stale, for changes that do not move the release (a draft save).
 */
export function invalidateGoLiveKeys(
  queryClient: QueryClient,
  siteId: string,
  refetchType: 'active' | 'none' = 'active',
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.releaseStatus(siteId),
      refetchType,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.publications(siteId),
      refetchType,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.buildJobs(siteId),
      refetchType,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.goLivePending(siteId),
      refetchType,
    }),
    // The agency "needs attention" lists read failed builds from it.
    queryClient.invalidateQueries({
      queryKey: queryKeys.sitesOverview(),
      refetchType,
    }),
  ])
}

/** Invalidate everything Go‑live reads for one site. */
export function useInvalidateGoLive(siteId: string) {
  const queryClient = useQueryClient()
  return () => invalidateGoLiveKeys(queryClient, siteId)
}

/**
 * Go live = `requestPublicationFn` (brief §1.2). Validation errors come back
 * as `{ ok: false, errors }`; they are kept in the query cache under
 * `golive-errors` so the tray and the panel show the same checklist.
 */
export function useGoLive(siteId: string) {
  const queryClient = useQueryClient()
  const actorId = useRouteContext({ from: '/_app' }).me.user.id
  const invalidate = useInvalidateGoLive(siteId)

  const errorsQuery = useQuery({
    queryKey: queryKeys.goLiveErrors(siteId),
    queryFn: () => [] as string[],
    initialData: [] as string[],
    staleTime: Infinity,
    enabled: false,
  })

  const mutation = useMutation({
    mutationKey: ['go-live', siteId],
    mutationFn: async (options: { urgent?: boolean } = {}) => {
      if (!actorId) throw new Error(m.golive_sign_in_before_publishing())
      const priority = options.urgent ? 100 : 0
      const identity = publishingRequestIdentity(
        actorId,
        siteId,
        'publish',
        JSON.stringify({ priority }),
        window.localStorage,
      )
      const result = await requestPublicationFn({
        data: { siteId, priority, requestKey: identity.key },
      })
      identity.complete()
      return result
    },
    onSuccess: async (result) => {
      if ('ok' in result && result.ok === false) {
        queryClient.setQueryData(queryKeys.goLiveErrors(siteId), result.errors)
        return
      }
      queryClient.setQueryData(queryKeys.goLiveErrors(siteId), [])
      toast.success(m.golive_toast_started(), {
        description: m.golive_toast_started_description(),
      })
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.golive_toast_failed())),
  })

  return {
    goLive: (options?: { urgent?: boolean }) =>
      mutation.mutateAsync(options ?? {}),
    isPending: mutation.isPending,
    errors: errorsQuery.data,
    clearErrors: () =>
      queryClient.setQueryData(queryKeys.goLiveErrors(siteId), []),
  }
}

/** Restore a previously live release ("Restore this version"). */
export function useRollback(siteId: string) {
  const actorId = useRouteContext({ from: '/_app' }).me.user.id
  const invalidate = useInvalidateGoLive(siteId)
  return useMutation({
    mutationFn: async (publicationId: string) => {
      if (!actorId) throw new Error(m.golive_sign_in_before_restoring())
      const identity = publishingRequestIdentity(
        actorId,
        siteId,
        'rollback',
        JSON.stringify({ publicationId }),
        window.localStorage,
      )
      const result = await requestRollbackFn({
        data: { siteId, publicationId, requestKey: identity.key },
      })
      identity.complete()
      if ('ok' in result) throw new Error(result.errors.join('; '))
      return result
    },
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

/** Reconcile the original deployment without dispatching another build. */
export function useReconcileDeployment(siteId: string) {
  const invalidate = useInvalidateGoLive(siteId)
  return useMutation({
    mutationFn: (jobId: string) =>
      reconcileDeploymentJobFn({ data: { id: jobId } }),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.golive_toast_failed())),
  })
}

export function useResolveUncertainDeployment(siteId: string) {
  const invalidate = useInvalidateGoLive(siteId)
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      resolveUncertainDeploymentJobFn({
        data: { ...input, upstreamStopped: true },
      }),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.golive_toast_failed())),
  })
}
