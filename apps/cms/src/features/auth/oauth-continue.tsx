import * as React from 'react'

import { Spinner } from '#/components/ui/spinner'
import { m } from '#/paraglide/messages'

import { AuthError, AuthHeading, AuthShell } from './auth-shell'
import { continueOAuth } from './oauth-resume'

/**
 * Signed in already (or back from a provider or second factor) with an AI
 * app's authorization still pending: carry on without asking anything again.
 */
export function OAuthContinue({ query }: { query: string }) {
  const [error, setError] = React.useState<string | null>(null)
  const started = React.useRef(false)

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    continueOAuth(query)
      .then((url) => window.location.assign(url))
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : m.auth_oauth_link_expired(),
        ),
      )
  }, [query])

  return (
    <AuthShell>
      <AuthHeading
        title={m.auth_oauth_continue_title()}
        description={error ? undefined : m.auth_oauth_continue_body()}
      />
      <div className="grid gap-4">
        {error ? (
          <AuthError className="w-full">{error}</AuthError>
        ) : (
          <Spinner
            size={24}
            label={m.auth_oauth_continue_title()}
            className="text-icon-accent"
          />
        )}
      </div>
    </AuthShell>
  )
}
