import type { ReactNode } from 'react'
import { WarningCircle, X } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

/**
 * A full-width alert above the page content: a tinted row with the message,
 * an action and a dismiss button. On phones the action sits under the text
 * and dismiss stays in the top corner; from sm the action sits beside the text.
 * Mail and verify-email reminders use it.
 */
export function BannerRow({
  tone,
  testId,
  message,
  action,
  dismissLabel,
  onDismiss,
}: {
  tone: 'warning' | 'error'
  testId: string
  message: ReactNode
  action: ReactNode
  dismissLabel: string
  onDismiss: () => void
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'flex items-start gap-3 rounded-card px-4 py-3 text-callout text-text-primary',
        tone === 'error' ? 'bg-status-error-bg' : 'bg-status-warning-bg',
      )}
    >
      <WarningCircle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'error' ? 'text-icon-error' : 'text-icon-warning',
        )}
      />
      <div className="grid min-w-0 flex-1 gap-2.5 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 break-words">{message}</div>
        {action ? <div className="flex shrink-0">{action}</div> : null}
      </div>
      <Button
        type="button"
        variant="quiet"
        size="icon-sm"
        className="-mt-1 -mr-1.5"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  )
}
