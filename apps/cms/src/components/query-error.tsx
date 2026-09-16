import { AlertCircle, RotateCw } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
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
 * Inline error block for a failed query. Renders the server message and an
 * optional Retry button so a transient failure never leaves the user staring
 * at an endless skeleton or a misleading empty state.
 */
export function QueryError({
  error,
  title = m.shared_could_not_load(),
  onRetry,
  retrying,
}: {
  error: unknown
  title?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <Alert variant="destructive" data-testid="query-error">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{messageFrom(error)}</p>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-fit"
            onClick={onRetry}
            disabled={retrying}
          >
            <RotateCw className={retrying ? 'animate-spin' : undefined} />
            {retrying ? m.shared_retrying() : m.shared_retry()}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
