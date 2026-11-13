import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  BellSlash,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  LinkBreak,
  LockSimple,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { AuthError, AuthHeading, AuthShell } from '#/features/auth/auth-shell'
import { errorMessage } from '#/lib/errors'
import type { EventKey, UnsubscribeStatus } from '#/lib/notifications'
import { m } from '#/paraglide/messages'
import { confirmUnsubscribeFn } from '#/server/fn/notifications'

import { eventLabel } from './notification-copy'

export type UnsubscribeResult = {
  status: UnsubscribeStatus
  event?: EventKey
  /** null or absent for agency alerts. */
  orgName?: string | null
}

/**
 * `/unsubscribe?token=…` (public, from a notification email). A valid link asks
 * once, then confirms; every other outcome says why and offers sign-in, where
 * the switches live.
 */
export function UnsubscribeScreen({
  token,
  result,
}: {
  token: string | undefined
  result: UnsubscribeResult
}) {
  const [pending, setPending] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (done) {
    return (
      <AuthShell footer={<ManageLink />}>
        <div className="grid gap-5" data-testid="unsubscribe-done">
          <Badge tone="success">
            <CheckCircle weight="duotone" className="size-7" />
          </Badge>
          <AuthHeading
            title={m.notifications_unsub_done_title()}
            description={m.notifications_unsub_done_body()}
          />
        </div>
      </AuthShell>
    )
  }

  if (result.status !== 'ok' || !token) {
    // An ok status without a token cannot happen; it reads as an invalid link.
    const status = result.status === 'ok' ? 'invalid' : result.status
    const copy = STATUS_COPY[status]
    return (
      <AuthShell>
        <div className="grid gap-5" data-testid={`unsubscribe-${status}`}>
          <Badge tone="neutral">
            <copy.Icon weight="duotone" className="size-7" />
          </Badge>
          <AuthHeading title={copy.title()} description={copy.body()} />
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link to="/login" search={{ redirect: '/account#notifications' }}>
              {m.notifications_unsub_sign_in()}
            </Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  const label = result.event ? eventLabel(result.event) : ''
  const about = result.orgName
    ? m.notifications_unsub_about({ event: label, org: result.orgName })
    : m.notifications_unsub_about_agency({ event: label })

  async function confirm() {
    if (!token) return
    setPending(true)
    setError(null)
    try {
      const outcome = await confirmUnsubscribeFn({ data: { token } })
      if (outcome.ok) setDone(true)
      else setError(outcome.message)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell>
      <div className="grid gap-5" data-testid="unsubscribe-confirm">
        <Badge tone="neutral">
          <EnvelopeSimple weight="duotone" className="size-7" />
        </Badge>
        <AuthHeading
          title={m.notifications_unsub_title()}
          description={about}
        />
        {error ? <AuthError>{error}</AuthError> : null}
        <Button
          type="button"
          variant="accent"
          size="lg"
          className="w-full"
          loading={pending}
          data-testid="unsubscribe-confirm-button"
          onClick={() => void confirm()}
        >
          {m.notifications_unsub_confirm()}
        </Button>
      </div>
    </AuthShell>
  )
}

const STATUS_COPY: Record<
  Exclude<UnsubscribeStatus, 'ok'>,
  {
    Icon: Icon
    title: () => string
    body: () => string
  }
> = {
  already_off: {
    Icon: BellSlash,
    title: () => m.notifications_unsub_already_title(),
    body: () => m.notifications_unsub_already_body(),
  },
  locked: {
    Icon: LockSimple,
    title: () => m.notifications_unsub_locked_title(),
    body: () => m.notifications_unsub_locked_body(),
  },
  invalid: {
    Icon: LinkBreak,
    title: () => m.notifications_unsub_invalid_title(),
    body: () => m.notifications_unsub_invalid_body(),
  },
  expired: {
    Icon: Clock,
    title: () => m.notifications_unsub_expired_title(),
    body: () => m.notifications_unsub_expired_body(),
  },
}

function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'success'
  children: React.ReactNode
}) {
  return (
    <span
      aria-hidden="true"
      className={
        tone === 'success'
          ? 'grid size-14 place-content-center rounded-[18px] bg-status-success-bg text-icon-success'
          : 'grid size-14 place-content-center rounded-[18px] bg-background-subtle text-icon-muted'
      }
    >
      {children}
    </span>
  )
}

function ManageLink() {
  return (
    <Link
      to="/account"
      hash="notifications"
      className="font-medium text-text-accent underline-offset-4 hover:underline"
      data-testid="unsubscribe-manage"
    >
      {m.notifications_unsub_manage()}
    </Link>
  )
}
