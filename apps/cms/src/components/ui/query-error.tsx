import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

function messageFrom(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return m.shared_something_went_wrong()
}

/**
 * Inline card for a failed query (brief §3.13): "Couldn't load {thing}", the
 * server message as a whisper, and Try again. Never an endless skeleton.
 */
export function QueryError({
  error,
  title = m.shared_could_not_load(),
  onRetry,
  retrying,
  className,
}: {
  error: unknown
  title?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div
      role="alert"
      data-testid="query-error"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 surface-card',
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-content-center rounded-full bg-status-error-bg text-icon-error">
        <WarningCircle weight="fill" className="size-[18px]" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-[14px] leading-5 font-medium text-text-primary">{title}</p>
        <p className="truncate text-caption font-normal text-text-muted" title={messageFrom(error)}>
          {messageFrom(error)}
        </p>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
        >
          <ArrowClockwise className={retrying ? 'animate-spin' : undefined} />
          {retrying ? m.shared_retrying() : m.ui_try_again()}
        </Button>
      ) : null}
    </div>
  )
}
