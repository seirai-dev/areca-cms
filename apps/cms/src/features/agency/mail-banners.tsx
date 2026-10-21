import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { WarningCircle, X } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

import { isMailFailing } from './mail-settings-logic'
import { useMailHealth } from './use-mail-settings'

const SETUP_KEY = 'areca.mail-banner.setup-dismissed'
const FAILING_KEY = 'areca.mail-banner.failing-dismissed'

/** Dismissed for this browser session only; a new session shows it again. */
function useSessionDismissed(key: string) {
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return sessionStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const dismiss = React.useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(key, '1')
    } catch {
      /* sessionStorage unavailable: the banner stays until the next visit */
    }
  }, [key])
  return [dismissed, dismiss] as const
}

/**
 * Agency-admin alerts on every page: mail isn't set up (invitations can still
 * be shared by link), or sends keep failing (three in a row).
 */
export function MailBanners() {
  const health = useMailHealth(true)
  const [setupDismissed, dismissSetup] = useSessionDismissed(SETUP_KEY)
  const [failingDismissed, dismissFailing] = useSessionDismissed(FAILING_KEY)
  const data = health.data
  if (!data) return null

  const showSetup = data.source === 'none' && !setupDismissed
  const showFailing = isMailFailing(data) && !failingDismissed
  if (!showSetup && !showFailing) return null

  return (
    <div className="mb-6 grid gap-3">
      {showFailing ? (
        <BannerRow
          tone="error"
          testId="mail-banner-failing"
          message={
            data.lastFailure
              ? m.shell_mail_failing_title({
                  message: data.lastFailure.message,
                })
              : m.shell_mail_failing_plain()
          }
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/agency/mail" hash="recent-emails">
                {m.shell_mail_view_recent()}
              </Link>
            </Button>
          }
          onDismiss={dismissFailing}
        />
      ) : null}
      {showSetup ? (
        <BannerRow
          tone="warning"
          testId="mail-banner-setup"
          message={m.shell_mail_setup_title()}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/agency/mail">{m.shell_mail_set_up()}</Link>
            </Button>
          }
          onDismiss={dismissSetup}
        />
      ) : null}
    </div>
  )
}

function BannerRow({
  tone,
  testId,
  message,
  action,
  onDismiss,
}: {
  tone: 'warning' | 'error'
  testId: string
  message: string
  action: React.ReactNode
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
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <div className="flex items-center gap-1.5">
        {action}
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          aria-label={m.shell_mail_dismiss()}
          onClick={onDismiss}
        >
          <X />
        </Button>
      </div>
    </div>
  )
}
