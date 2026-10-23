import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { m } from '#/paraglide/messages'

import type { BulkResult } from './use-collection-entries'

/** The entries a bulk action could not change, with the reason for each. */
export function BulkFailuresDialog({
  details,
  pending,
  onClose,
  onRetry,
}: {
  details: BulkResult | null
  pending: boolean
  onClose: () => void
  onRetry: () => void
}) {
  return (
    <Dialog
      open={details !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.collection_bulk_details_title()}</DialogTitle>
          <DialogDescription>
            {m.collection_bulk_details_hint()}
          </DialogDescription>
        </DialogHeader>
        <ul
          className="grid max-h-[50vh] gap-2 overflow-y-auto"
          data-testid="bulk-failures"
        >
          {details?.failed.map((item) => (
            <li
              key={item.id}
              className="grid min-w-0 gap-0.5 rounded-[10px] bg-background-subtle px-3 py-2"
              data-testid="bulk-failure"
            >
              <span className="text-[14px] leading-5 font-medium break-words text-text-primary">
                {item.title}
                {item.slug ? (
                  <span className="ml-2 font-mono text-[12px] font-normal text-text-muted">
                    {item.slug}
                  </span>
                ) : null}
              </span>
              <span className="text-callout break-words text-text-secondary">
                {item.reason}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            {m.ui_close()}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={onRetry}
            data-testid="bulk-retry-failed"
          >
            {m.collection_bulk_retry_failed()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
