import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { BannerRow } from '#/components/shell/banner-row'
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
          dismissLabel={m.shell_mail_dismiss()}
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
          dismissLabel={m.shell_mail_dismiss()}
          onDismiss={dismissSetup}
        />
      ) : null}
    </div>
  )
}
