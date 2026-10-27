import * as React from 'react'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { m } from '#/paraglide/messages'

import { resetDevEnvDescription } from './reset-copy'
import { useDevSyncStatus } from './use-push'

/**
 * The reset confirm of a development environment. Opening it fetches the
 * unpushed count again (a push or an edit may have changed it since the page
 * loaded), and says so while the count is loading.
 */
export function ResetDevEnvConfirm({
  devSiteId,
  testId,
  onConfirm,
  children,
}: {
  devSiteId: string
  testId: string
  onConfirm: () => Promise<void>
  /** The button that opens the dialog. */
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const sync = useDevSyncStatus(devSiteId)
  const count = sync.data?.unpushedChanges

  let description: string
  if (sync.isFetching) {
    description = m.dev_env_reset_checking()
  } else if (count === undefined) {
    // The count could not be read: the generic text holds either way.
    description = m.dev_env_reset_description()
  } else {
    description = resetDevEnvDescription(count)
  }

  return (
    <ConfirmDialog
      title={m.dev_env_reset_title()}
      description={description}
      confirmLabel={m.dev_env_reset_confirm()}
      variant="destructive"
      testId={testId}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void sync.refetch()
      }}
      onConfirm={onConfirm}
    >
      {children}
    </ConfirmDialog>
  )
}
