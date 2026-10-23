import * as React from 'react'
import {
  Desktop,
  DeviceMobile,
  DeviceTablet,
  WarningCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { authClient } from '#/lib/auth-client'
import { formatRelativeTime } from '#/lib/relative-time'
import { signOutClient } from '#/lib/sign-out'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'

import { AccountNav } from './account-nav'
import { isSessionNotFresh, orderSessions } from './sessions'
import { parseUserAgent } from './user-agent'
import type { DeviceKind } from './user-agent'
import {
  useAccountSessions,
  useRevokeOtherSessions,
  useRevokeSession,
} from './use-sessions'

/**
 * `/account/sessions`: where you are signed in. This device is marked and
 * has no sign-out of its own (use the account menu). Other sessions sign out
 * one by one, or all at once. Better Auth shows the list only to a recent
 * sign-in, so a stale session gets a sign-in-again prompt instead.
 */
export function SessionsScreen() {
  const current = authClient.useSession().data
  const currentToken = current?.session.token
  const query = useAccountSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const [confirmOthers, setConfirmOthers] = React.useState(false)

  const sessions = orderSessions(query.data ?? [], currentToken)
  const otherCount = sessions.filter(
    (session) => session.token !== currentToken,
  ).length

  function signOut(token: string) {
    revoke.mutate(token, {
      onSuccess: () => toast.success(m.account_sessions_signed_out()),
      onError: () => toast.error(m.account_sessions_sign_out_failed()),
    })
  }

  async function signOutOthers() {
    try {
      await revokeOthers.mutateAsync()
      toast.success(m.account_sessions_signed_out_others())
    } catch {
      toast.error(m.account_sessions_sign_out_failed())
    }
  }

  return (
    <div className="grid max-w-[880px] gap-8" data-testid="sessions-page">
      <div className="grid gap-4">
        <PageHeader
          title={m.account_sessions_title()}
          description={m.account_sessions_description()}
        />
        <AccountNav current="sessions" />
      </div>

      {query.isError && isSessionNotFresh(query.error) ? (
        <SignInAgainCard />
      ) : query.isError ? (
        <QueryError
          title={m.account_sessions_load_error()}
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          <Skeleton className="h-[72px] rounded-card" />
          <Skeleton className="h-[72px] rounded-card" />
        </div>
      ) : (
        <SettingsSection
          id="sessions"
          title={m.account_sessions_section_title()}
          description={m.account_sessions_section_description()}
        >
          <InsetList data-testid="sessions-list">
            {sessions.map((session) => {
              const isCurrent = session.token === currentToken
              const parsed = parseUserAgent(session.userAgent)
              const pending =
                revoke.isPending && revoke.variables === session.token
              return (
                <InsetRow
                  key={session.id}
                  data-testid={isCurrent ? 'session-current' : 'session-row'}
                  leading={<DeviceIcon device={parsed.device} />}
                  title={deviceLabel(parsed)}
                  subtitle={
                    <span className="grid gap-0.5">
                      {isCurrent ? (
                        <span className="font-medium text-text-accent">
                          {m.account_sessions_this_device()}
                        </span>
                      ) : null}
                      <span>
                        {m.account_sessions_last_active({
                          time: formatRelativeTime(session.updatedAt),
                        })}
                      </span>
                      {session.ipAddress ? (
                        <span className="text-caption text-text-muted tnum">
                          {m.account_sessions_ip({ ip: session.ipAddress })}
                        </span>
                      ) : null}
                    </span>
                  }
                  wrapSubtitle
                  trailing={
                    isCurrent ? null : (
                      <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        loading={pending}
                        disabled={revoke.isPending}
                        onClick={() => signOut(session.token)}
                        data-testid="session-sign-out"
                      >
                        {m.account_sessions_sign_out()}
                      </Button>
                    )
                  }
                />
              )
            })}
          </InsetList>

          <div className="grid gap-2 sm:flex sm:items-center sm:justify-between">
            <p className="text-callout text-text-secondary">
              {otherCount === 0 ? m.account_sessions_none_other() : null}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={otherCount === 0 || revokeOthers.isPending}
              loading={revokeOthers.isPending}
              onClick={() => setConfirmOthers(true)}
              data-testid="sessions-sign-out-others"
            >
              {m.account_sessions_sign_out_others()}
            </Button>
          </div>
        </SettingsSection>
      )}

      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title={m.account_sessions_sign_out_others_title()}
        description={m.account_sessions_sign_out_others_description()}
        confirmLabel={m.account_sessions_sign_out_others_confirm()}
        variant="destructive"
        onConfirm={signOutOthers}
        testId="sessions-sign-out-others-dialog"
      />
    </div>
  )
}

function deviceLabel(parsed: ReturnType<typeof parseUserAgent>) {
  if (parsed.browser && parsed.os) {
    return m.account_sessions_device({
      browser: parsed.browser,
      os: parsed.os,
    })
  }
  return parsed.browser ?? parsed.os ?? m.account_sessions_unknown_device()
}

function DeviceIcon({ device }: { device: DeviceKind }) {
  if (device === 'mobile') return <DeviceMobile aria-hidden="true" />
  if (device === 'tablet') return <DeviceTablet aria-hidden="true" />
  return <Desktop aria-hidden="true" />
}

/**
 * The session is older than Better Auth's fresh age, so the list is withheld.
 * A new sign-in makes it fresh; this signs out and returns to this page.
 */
function SignInAgainCard() {
  return (
    <div
      role="alert"
      data-testid="sessions-sign-in-again"
      className="grid gap-4 px-5 py-5 surface-card"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-content-center rounded-full bg-status-warning-bg text-icon-warning">
          <WarningCircle weight="fill" className="size-[18px]" />
        </span>
        <div className="grid gap-0.5">
          <p className="text-[14px] leading-5 font-medium text-text-primary">
            {m.account_sessions_reauth_title()}
          </p>
          <p className="text-callout text-text-secondary">
            {m.account_sessions_reauth_body()}
          </p>
        </div>
      </div>
      <Button
        type="button"
        className="justify-self-start"
        onClick={() => {
          void signOutClient().finally(() => {
            window.location.assign(
              `${localizeHref('/login')}?redirect=${encodeURIComponent(localizeHref('/account/sessions'))}`,
            )
          })
        }}
      >
        {m.account_sessions_reauth_action()}
      </Button>
    </div>
  )
}
