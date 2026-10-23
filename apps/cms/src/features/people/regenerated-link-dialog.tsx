import { CopyButton } from '#/components/ui/copy-button'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { m } from '#/paraglide/messages'

import type { RegeneratedLink } from './use-members'

/**
 * The new invitation link, shown once. The server keeps only its hash, so
 * closing this dialog means the link cannot be shown again.
 * Test ids: `invitation-link-dialog`, `invitation-link-value`,
 * `invitation-link-copy`, `invitation-link-done`.
 */
export function RegeneratedLinkDialog({
  link,
  email,
  onClose,
}: {
  /** Null while closed. */
  link: RegeneratedLink | null
  email: string
  onClose: () => void
}) {
  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent size="md" data-testid="invitation-link-dialog">
        {link ? (
          <div className="grid gap-5">
            <DialogHeader className="pr-8">
              <DialogTitle>{m.people_invite_regenerate_title()}</DialogTitle>
              <DialogDescription>
                {m.people_invite_regenerate_description({ email })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2 rounded-control border border-border-default bg-background-surface py-1.5 pr-1.5 pl-3">
              <code
                data-testid="invitation-link-value"
                className="min-w-0 flex-1 bg-transparent p-0 text-mono break-all text-text-primary select-all"
              >
                {link.link}
              </code>
              <CopyButton
                value={link.link}
                label={m.people_invite_copy_link()}
                copiedLabel={m.admin_token_copied_label()}
                toastMessage={m.people_invite_link_copied()}
                variant="secondary"
                size="xs"
                data-testid="invitation-link-copy"
              />
            </div>

            <p className="text-callout text-text-secondary">
              {m.people_invite_regenerate_once()}
            </p>

            {link.emailSent ? (
              <p
                className="text-callout text-text-secondary"
                data-testid="invitation-link-emailed"
              >
                {m.people_invite_regenerate_email_sent({ email })}
              </p>
            ) : (
              <p
                role="alert"
                className="text-callout text-text-error"
                data-testid="invitation-link-not-sent"
              >
                {m.people_invite_regenerate_email_failed({
                  reason: link.emailError ?? '',
                })}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onClose}
                data-testid="invitation-link-done"
              >
                {m.people_invite_regenerate_done()}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
