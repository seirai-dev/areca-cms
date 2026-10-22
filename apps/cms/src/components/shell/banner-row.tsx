import type { ReactNode } from 'react'
import { WarningCircle, X } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'

/**
 * A full-width alert above the page content: a tinted row with the message,
 * an action and a dismiss button. Mail and verify-email reminders use it.
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
      className={
        tone === 'error'
          ? 'flex flex-wrap items-center gap-3 rounded-card bg-status-error-bg px-4 py-3 text-callout text-text-primary'
          : 'flex flex-wrap items-center gap-3 rounded-card bg-status-warning-bg px-4 py-3 text-callout text-text-primary'
      }
    >
      <WarningCircle
        className={
          tone === 'error'
            ? 'size-4 shrink-0 text-icon-error'
            : 'size-4 shrink-0 text-icon-warning'
        }
      />
      <div className="min-w-[min(100%,16rem)] flex-1 break-words">
        {message}
      </div>
      <div className="flex items-center gap-1.5">
        {action}
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X />
        </Button>
      </div>
    </div>
  )
}
