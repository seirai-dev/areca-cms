import * as React from 'react'
import { Check, Sparkle } from '@phosphor-icons/react'
import { useServerFn } from '@tanstack/react-start'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { useStepUp } from '#/features/security/step-up'
import { errorMessage } from '#/lib/admin/helpers'
import { REAUTH_REQUIRED, securityErrorCode } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'
import {
  approveOAuthConsentFn,
  denyOAuthConsentFn,
} from '#/server/fn/mcp-oauth'
import type { ConsentInfo } from '#/server/mcp/consent'

import { AuthError, AuthHeading, AuthShell } from './auth-shell'
import { useHydrated } from './use-auth-forms'

type ConsentOk = Extract<ConsentInfo, { ok: true }>
type ConsentProblemInfo = Extract<ConsentInfo, { ok: false }>

/**
 * `/oauth/consent`: an AI app asks to act on one site as the signed-in user.
 * The screen names the app, the site, the role it will act with and what that
 * allows, and makes the user choose. Nothing is granted until "Allow".
 */
export function ConsentScreen({
  query,
  info,
}: {
  query: string
  info: ConsentInfo
}) {
  if (!info.ok) return <ConsentProblem query={query} info={info} />
  return <ConsentRequest query={query} info={info} />
}

/** Cannot show the request: say why, and offer a way back where one exists. */
function ConsentProblem({
  query,
  info,
}: {
  query: string
  info: ConsentProblemInfo
}) {
  const deny = useServerFn(denyOAuthConsentFn)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const title =
    info.reason === 'unknown_site'
      ? m.oauth_consent_site_title()
      : info.reason === 'no_access'
        ? m.oauth_consent_access_title()
        : m.oauth_consent_invalid_title()
  const body =
    info.reason === 'invalid_request'
      ? m.oauth_consent_invalid_body()
      : info.message
  // Only a valid request can be turned down (it carries the app's redirect).
  const canGoBack =
    info.reason === 'no_access' || info.reason === 'unknown_site'

  async function goBack() {
    setPending(true)
    setError(null)
    try {
      const { redirectTo } = await deny({ data: { query } })
      window.location.assign(redirectTo)
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }

  return (
    <AuthShell>
      <AuthHeading title={title} description={body} />
      {error ? <AuthError className="mt-6">{error}</AuthError> : null}
      {canGoBack ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="mt-7 min-h-11 w-full"
          loading={pending}
          onClick={() => void goBack()}
          data-testid="oauth-consent-back"
        >
          {m.oauth_consent_back()}
        </Button>
      ) : null}
    </AuthShell>
  )
}

/** The request itself: app, site, role, what it can do, then Allow or Cancel. */
function ConsentRequest({ query, info }: { query: string; info: ConsentOk }) {
  const { client, site, role, canAllowGoLive, needsStepUp } = info
  const approve = useServerFn(approveOAuthConsentFn)
  const deny = useServerFn(denyOAuthConsentFn)
  const stepUp = useStepUp()
  const goLiveId = React.useId()
  const goLiveHintId = React.useId()
  const ready = useHydrated()
  const [goLive, setGoLive] = React.useState(false)
  const [pending, setPending] = React.useState<'allow' | 'cancel' | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const roleLabel =
    role === 'agency'
      ? m.oauth_consent_role_agency()
      : role === 'owner'
        ? m.oauth_consent_role_owner()
        : m.oauth_consent_role_editor()
  const allowGoLive = canAllowGoLive && goLive
  const canDo = [
    m.oauth_consent_can_read(),
    m.oauth_consent_can_write(),
    m.oauth_consent_can_upload(),
    ...(role === 'editor'
      ? []
      : [m.oauth_consent_can_review(), m.oauth_consent_can_delete_files()]),
    ...(role === 'agency' ? [m.oauth_consent_can_content_types()] : []),
    ...(allowGoLive ? [m.oauth_consent_can_go_live()] : []),
  ]

  async function allow() {
    setPending('allow')
    setError(null)
    try {
      // Agency admins confirm with a fresh authenticator code first (the
      // step-up dialog retries this once the code is accepted).
      const { redirectTo } = await stepUp.run(() =>
        approve({ data: { query, siteId: site.id, allowGoLive } }),
      )
      window.location.assign(redirectTo)
    } catch (err) {
      setError(
        securityErrorCode(err) === REAUTH_REQUIRED
          ? m.oauth_consent_reauth()
          : errorMessage(err),
      )
      setPending(null)
    }
  }

  async function cancel() {
    setPending('cancel')
    setError(null)
    try {
      const { redirectTo } = await deny({ data: { query } })
      window.location.assign(redirectTo)
    } catch (err) {
      setError(errorMessage(err))
      setPending(null)
    }
  }

  return (
    <AuthShell
      footer={m.oauth_consent_footer({ app: client.name, site: site.name })}
    >
      <div
        className="grid gap-6"
        data-testid="oauth-consent"
        data-ready={ready ? 'true' : 'false'}
      >
        <div className="grid justify-items-center gap-3">
          {/* Anonymous client metadata is unverified. Loading its logo before
              approval would contact an app-controlled URL from the browser. */}
          <span
            aria-hidden="true"
            className="grid size-14 place-content-center rounded-[14px] bg-accent-soft text-icon-accent"
          >
            <Sparkle weight="duotone" className="size-7" />
          </span>
          <AuthHeading
            title={m.oauth_consent_title({ app: client.name, site: site.name })}
            description={m.oauth_consent_subtitle({
              app: client.name,
              site: site.name,
              role: roleLabel,
            })}
          />
          <p
            className="text-caption text-text-muted"
            data-testid="oauth-consent-host"
          >
            {m.oauth_consent_redirect_host({ host: client.redirectHost })}
          </p>
        </div>

        <section
          className="grid gap-3 rounded-card bg-background-subtle p-4"
          aria-labelledby="oauth-consent-can"
          data-testid="oauth-consent-can"
        >
          <h2
            id="oauth-consent-can"
            className="text-headline text-text-primary"
          >
            {m.oauth_consent_can_title()}
          </h2>
          <ul className="grid gap-2">
            {canDo.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-callout text-text-primary"
              >
                <Check
                  weight="bold"
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-icon-accent"
                />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-callout text-text-secondary">
            {m.oauth_consent_cannot()}
          </p>
        </section>

        {canAllowGoLive ? (
          <div className="flex items-start gap-3 rounded-card border border-border-default p-4">
            <Checkbox
              id={goLiveId}
              checked={goLive}
              disabled={!ready}
              onCheckedChange={(value) => setGoLive(value === true)}
              aria-describedby={goLiveHintId}
              className="mt-0.5 size-5"
              data-testid="oauth-consent-go-live"
            />
            <div className="grid min-w-0 gap-1">
              <label
                htmlFor={goLiveId}
                className="text-[14px] leading-5 font-medium text-text-primary"
              >
                {m.oauth_consent_go_live_label()}
              </label>
              <p id={goLiveHintId} className="text-callout text-text-secondary">
                {m.oauth_consent_go_live_hint()}
              </p>
            </div>
          </div>
        ) : null}

        {needsStepUp ? (
          <p
            className="text-callout text-text-secondary"
            data-testid="oauth-consent-stepup"
          >
            {m.oauth_consent_stepup_hint()}
          </p>
        ) : null}

        {error ? <AuthError>{error}</AuthError> : null}

        <div className="grid gap-2">
          <Button
            type="button"
            size="lg"
            className="min-h-11 w-full"
            loading={pending === 'allow'}
            // Until the page has hydrated, a click would do nothing and be lost.
            disabled={!ready || pending === 'cancel'}
            onClick={() => void allow()}
            data-testid="oauth-consent-allow"
          >
            {m.oauth_consent_allow()}
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="lg"
            className="min-h-11 w-full"
            loading={pending === 'cancel'}
            disabled={!ready || pending === 'allow'}
            onClick={() => void cancel()}
            data-testid="oauth-consent-cancel"
          >
            {m.oauth_consent_cancel()}
          </Button>
        </div>
      </div>
    </AuthShell>
  )
}
