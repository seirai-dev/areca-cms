import type { ReactNode } from 'react'

import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Sticky bar at the bottom of a settings page. It only exists while the page
 * is dirty: no permanent Save button competing for attention.
 */
export function SaveBar({
  dirty,
  saving = false,
  onSave,
  label,
  savingLabel,
  message,
  actions,
  testId,
  className,
}: {
  dirty: boolean
  saving?: boolean
  onSave?: () => void
  /** Overrides the "Save changes" button label. */
  label?: ReactNode
  /** Overrides the label while the save is in flight. */
  savingLabel?: ReactNode
  /** Overrides the "Unsaved changes" status text. */
  message?: ReactNode
  /** Extra controls left of the save button (for example Reset). */
  actions?: ReactNode
  testId?: string
  className?: string
}) {
  if (!dirty) return null

  return (
    <div
      data-slot="save-bar"
      className={cn(
        'sticky bottom-0 z-navbar mt-8 flex flex-wrap items-center justify-between gap-3',
        'rounded-surface border border-border-default bg-background-surface px-4 py-3 shadow-lg',
        className,
      )}
    >
      <p className="text-ds-body-sm text-text-secondary">
        {message ?? m.shared_unsaved_changes()}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <Button
          type="submit"
          onClick={onSave}
          disabled={saving}
          data-testid={testId}
        >
          {saving ? <Spinner /> : null}
          {saving
            ? (savingLabel ?? m.shared_saving())
            : (label ?? m.shared_save_changes())}
        </Button>
      </div>
    </div>
  )
}
