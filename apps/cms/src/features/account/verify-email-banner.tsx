import * as React from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { toast } from 'sonner'

import { BannerRow } from '#/components/shell/banner-row'
import { Button } from '#/components/ui/button'
import { errorMessage } from '#/lib/admin/helpers'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import { requestVerificationEmailFn } from '#/server/fn/account'

import {
  isVerifiedRedirect,
  needsEmailVerification,
  verifyEmailDismissedKey,
  withoutVerifiedParam,
} from './verify-email-logic'

/**
 * Asks people who have not confirmed their address to do so. "Not now" hides it
 * for this browser and account. The state is read after mount so the server
 * render and the first client render agree.
 */
export function VerifyEmailBanner({ me }: { me: Me }) {
  const router = useRouter()
  const key = verifyEmailDismissedKey(me.user.id)
  const [dismissed, setDismissed] = React.useState<boolean | null>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    try {
      setDismissed(localStorage.getItem(key) === '1')
    } catch {
      setDismissed(false)
    }
  }, [key])

  if (!needsEmailVerification(me) || dismissed !== false) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(key, '1')
    } catch {
      /* localStorage unavailable: the reminder returns on the next visit */
    }
  }

  async function send() {
    setPending(true)
    try {
      const result = await requestVerificationEmailFn()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(m.shell_verify_email_sent())
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mb-6">
      <BannerRow
        tone="warning"
        testId="verify-email-banner"
        message={
          <span className="grid gap-0.5">
            <span className="font-medium text-text-primary">
              {m.shell_verify_email_title()}
            </span>
            <span className="text-text-secondary">
              {m.shell_verify_email_body({ email: me.user.email })}
            </span>
          </span>
        }
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => void send()}
            data-testid="verify-email-send"
          >
            {m.shell_verify_email_send()}
          </Button>
        }
        dismissLabel={m.shell_verify_email_dismiss()}
        onDismiss={dismiss}
      />
    </div>
  )
}

/**
 * Arriving on `?verified=1` (from the verification link) confirms once, then
 * drops the parameter so a refresh does not repeat the toast.
 */
export function EmailVerifiedNotice() {
  const navigate = useNavigate()
  const verified = useRouterState({
    select: (state) => isVerifiedRedirect(state.location.searchStr),
  })
  const handled = React.useRef(false)

  React.useEffect(() => {
    if (!verified || handled.current) return
    handled.current = true
    toast.success(m.shell_verify_email_verified())
    void navigate({
      to: '.',
      search: (previous) => withoutVerifiedParam(previous),
      replace: true,
    })
  }, [verified, navigate])

  return null
}
