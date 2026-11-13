import { Link } from '@tanstack/react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { errorDetail } from '#/lib/errors'
import { MFA_REQUIRED, securityErrorCode } from '#/lib/security-errors'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Inline card for a failed query (brief §3.13): "Couldn't load {thing}", the
 * server message as a whisper, and Try again. Never an endless skeleton.
 *
 * Pass the failed `query` (its error, refetch and fetching state), or
 * `error` with `onRetry` and `retrying` for anything else.
 */
export function QueryError({
  query,
  title = m.shared_could_not_load(),
  className,
  ...props
}: {
  title?: string
  className?: string
} & (
  | {
      query: Pick<UseQueryResult, 'error' | 'refetch' | 'isFetching'>
      error?: never
      onRetry?: never
      retrying?: never
    }
  | {
      query?: never
      error: unknown
      onRetry?: () => void
      retrying?: boolean
    }
)) {
  const error = query ? query.error : props.error
  const onRetry = query ? () => void query.refetch() : props.onRetry
  const retrying = query ? query.isFetching : props.retrying
  // An agency admin who has not enrolled in two-factor gets a way forward
  // instead of a generic failure.
  const mfaRequired = securityErrorCode(error) === MFA_REQUIRED
  const detail = errorDetail(error)
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
