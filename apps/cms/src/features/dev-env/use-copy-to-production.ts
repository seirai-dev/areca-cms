import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/content/utils'
import { isCopyOverwriteRefusal } from '#/lib/dev-env'
import { m } from '#/paraglide/messages'
import { useStepUp } from '#/features/security/step-up'
import { copyEntryToProductionFn } from '#/server/fn/dev-env'

import { useDevSyncStatus } from './use-push'

export type CopyEntryInput = { devEntryId: string; overwrite?: boolean }

/**
 * The production entry a copy wrote to: a collection entry opens in the
 * editor, a section opens its section page.
 */
export type CopyDestination =
  | { kind: 'collection'; collectionKey: string }
  | { kind: 'global'; globalKey: string }

/**
 * Copy one dev entry or section to production as its draft
 * (docs/design/dev-environments.md, Decision 18). Runs in the step-up wrapper.
 * A conflict offers Overwrite on its toast, which retries with `overwrite`:
 * that is the only extra step, with no confirm dialog.
 */
export function useCopyToProduction({
  productionSiteId,
  destination,
}: {
  productionSiteId: string
  destination: CopyDestination
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const stepUp = useStepUp()
  const copy = useServerFn(copyEntryToProductionFn)

  const mutation = useMutation({
    mutationFn: (input: CopyEntryInput) =>
      stepUp.run(() =>
        copy({
          data: {
            devEntryId: input.devEntryId,
            markReady: false,
            overwrite: input.overwrite ?? false,
          },
        }),
      ),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['push-plan'] }),
        queryClient.invalidateQueries({ queryKey: ['dev-sync'] }),
        queryClient.invalidateQueries({ queryKey: ['dev-environment'] }),
        queryClient.invalidateQueries({
          queryKey: ['entries', productionSiteId],
        }),
      ])
      toast.success(m.dev_env_copy_success(), {
        description: result.warnings.length
          ? result.warnings.join(' ')
          : undefined,
        action: {
          label: m.dev_env_copy_open(),
          onClick: () => {
            if (destination.kind === 'global') {
              void navigate({
                to: '/sites/$siteId/globals/$globalKey',
                params: {
                  siteId: productionSiteId,
                  globalKey: destination.globalKey,
                },
              })
              return
            }
            void navigate({
              to: '/sites/$siteId/c/$collectionKey/$entryId',
              params: {
                siteId: productionSiteId,
                collectionKey: destination.collectionKey,
                entryId: result.productionId,
              },
            })
          },
        },
      })
    },
    onError: (error, input) => {
      const message = errorMessage(error)
      if (isCopyOverwriteRefusal(message)) {
        toast.error(message, {
          action: {
            label: m.dev_env_copy_overwrite(),
            onClick: () => mutation.mutate({ ...input, overwrite: true }),
          },
        })
        return
      }
      toast.error(message)
    },
  })
  return mutation
}

export type CopyEntryAction = {
  copy: () => void
  pending: boolean
  /** Why the copy is blocked, or null. Shown under the menu item. */
  blockedReason: string | null
}

/**
 * The editor menu's copy action for one dev entry: null on a production site.
 * `blockedReason` disables the item when the collection's schema differs from
 * production (the copy would be refused with "Push the schema first.").
 */
export function useCopyEntryAction({
  devSiteId,
  productionSiteId,
  isDevelopment,
  collectionKey,
  destination,
  devEntryId,
}: {
  devSiteId: string
  productionSiteId: string | null
  isDevelopment: boolean
  collectionKey: string
  destination: CopyDestination
  devEntryId: string | undefined
}): CopyEntryAction | null {
  // Only a dev env has a sync status; the query stays off for production sites.
  const sync = useDevSyncStatus(devSiteId, { enabled: isDevelopment })
  const mutation = useCopyToProduction({
    productionSiteId: productionSiteId ?? '',
    destination,
  })
  const { mutate } = mutation
  const copy = React.useCallback(() => {
    if (devEntryId) mutate({ devEntryId })
  }, [devEntryId, mutate])

  if (!isDevelopment || !productionSiteId) return null
  const matches = sync.data?.schemaMatches[collectionKey]
  return {
    copy,
    pending: mutation.isPending,
    blockedReason: matches === false ? m.dev_env_copy_blocked_schema() : null,
  }
}
