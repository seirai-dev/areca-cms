import { Link } from '@tanstack/react-router'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  MFA_REQUIRED,
  securityErrorCode,
  stripSecurityCode,
} from '#/lib/security-errors'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Messages written for developers: React Query's own text (for example
 * `data is undefined` when a query returns nothing) and JS runtime errors.
 */
const INTERNAL_ERROR =
  /data is undefined|cannot be undefined|Affected query key|^\[|is not a function|Cannot read propert/i

/** The server's message when it is safe to show, otherwise null (title only). */
function messageFrom(error: unknown): string | null {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined
  if (typeof message !== 'string' || !message) return null
  if (error instanceof TypeError || INTERNAL_ERROR.test(message)) return null
  return stripSecurityCode(message)
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
  // An agency admin who has not enrolled in two-factor gets a way forward
  // instead of a generic failure.
  const mfaRequired = securityErrorCode(error) === MFA_REQUIRED
  const detail = messageFrom(error)
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
      {/* A basis, not flex-1 alone: on a phone the button wraps under the text. */}
      <div className="grid min-w-0 grow basis-40 gap-0.5">
        <p className="text-[14px] leading-5 font-medium text-text-primary">
          {mfaRequired ? m.account_mfa_required_title() : title}
        </p>
        {detail ? (
          <p className="text-caption font-normal break-words text-text-muted">
            {detail}
          </p>
        ) : null}
      </div>
      {mfaRequired ? (
        <Button asChild variant="secondary" size="sm">
          <Link to="/account" data-testid="mfa-setup-link">
            {m.account_mfa_required_action()}
          </Link>
        </Button>
      ) : onRetry ? (
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
