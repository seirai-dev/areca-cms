import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { FormField } from '#/components/ui/form-field'
import { Textarea } from '#/components/ui/textarea'
import { usePeopleMutations } from '#/features/agency/use-people-mutations'
import { errorMessage } from '#/lib/admin/helpers'
import { m } from '#/paraglide/messages'

/** The block dialog's internal note is optional and never shown to the person. */
export const BLOCK_REASON_LIMIT = 500

/**
 * Blocks one person, with an optional internal note that only agency admins see.
 * The same dialog serves the person page and the People list's row menu.
 */
export function BlockPersonDialog({
  open,
  onClose,
  userId,
  name,
}: {
  open: boolean
  onClose: () => void
  userId: string
  name: string
}) {
  const mutations = usePeopleMutations()
  const [reason, setReason] = React.useState('')

  function close(next: boolean) {
    if (!next) {
      setReason('')
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="sm" data-testid="person-block-dialog">
        <DialogHeader>
          <DialogTitle>{m.agency_person_block_title({ name })}</DialogTitle>
          <DialogDescription>
            {m.agency_person_block_description()}
          </DialogDescription>
        </DialogHeader>
        <FormField
          label={m.agency_person_block_reason_label()}
          htmlFor="person-block-reason"
          hint={m.agency_person_block_reason_hint()}
        >
          <Textarea
            id="person-block-reason"
            rows={3}
            maxLength={BLOCK_REASON_LIMIT}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="person-block-reason"
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            {m.shared_cancel()}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={mutations.block.isPending}
            data-testid="confirm-action"
            onClick={async () => {
              try {
                await mutations.block.mutateAsync({
                  userId,
                  reason: reason.trim() || undefined,
                })
                toast.success(m.agency_person_toast_blocked({ name }))
              } catch (error) {
                toast.error(errorMessage(error))
              }
              close(false)
            }}
          >
            {m.agency_person_block_confirm({ name })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
