import * as React from 'react'
import { Desktop, DeviceMobile, DeviceTablet } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'

import { AccountNav } from './account-nav'
import { orderSessions } from './sessions'
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
 * one by one, or all at once. The list comes from the server, without tokens.
 */
export function SessionsScreen() {
  const query = useAccountSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const [confirmOthers, setConfirmOthers] = React.useState(false)

  const sessions = orderSessions(query.data ?? [])
  const otherCount = sessions.filter((session) => !session.current).length

  function signOut(sessionId: string) {
    revoke.mutate(sessionId, {
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

      {query.isError ? (
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
          bare
          // The account nav already draws the rule above this section.
          className="border-t-0 pt-0"
          title={m.account_sessions_section_title()}
          description={m.account_sessions_section_description()}
        >
          <InsetList data-testid="sessions-list">
            {sessions.map((session) => {
              const isCurrent = session.current
              const parsed = parseUserAgent(session.userAgent)
              const pending =
                revoke.isPending && revoke.variables === session.id
              return (
                <InsetRow
                  key={session.id}
                  data-testid={isCurrent ? 'session-current' : 'session-row'}
                  className="gap-2.5 px-3"
                  leading={<DeviceIcon device={parsed.device} />}
                  title={
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate">{deviceLabel(parsed)}</span>
                      {isCurrent ? (
                        <span className="shrink-0 text-caption font-medium text-text-accent">
                          {m.account_sessions_this_device()}
                        </span>
                      ) : null}
                    </span>
                  }
                  subtitle={
                    <span className="text-caption text-text-muted tnum">
                      {m.account_sessions_last_active({
                        time: formatRelativeTime(session.updatedAt),
                      })}
                      {session.ipAddress
                        ? ` · ${m.account_sessions_ip({ ip: session.ipAddress })}`
                        : null}
                    </span>
                  }
                  wrapSubtitle
                  trailing={
                    isCurrent ? null : (
                      <Button
                        type="button"
                        variant="quiet"
                        size="xs"
                        className="px-1.5"
                        loading={pending}
                        disabled={revoke.isPending}
                        onClick={() => signOut(session.id)}
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

          <div className="mt-3 grid gap-2 sm:flex sm:items-center sm:justify-between">
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
