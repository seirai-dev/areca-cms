import { WarningCircle } from '@phosphor-icons/react'

import { PageHeader } from '#/components/ui/page-header'
import { SettingsSection } from '#/components/ui/settings-section'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

import { TwoFactorSection } from './two-factor-section'

/**
 * `/account`: who you are and how you sign in. Reachable by everyone,
 * including agency admins who still have to enrol in two-factor, so it is
 * the one signed-in page the enrolment redirect leaves alone.
 */
export function AccountScreen({ me }: { me: Me }) {
  return (
    <div className="grid max-w-[880px] gap-8" data-testid="account-page">
      <PageHeader
        title={m.account_title()}
        description={m.account_description()}
      />

      {me.mfaEnrolmentRequired ? (
        <div
          role="alert"
          data-testid="mfa-required-notice"
          className="flex items-start gap-3 px-4 py-3.5 surface-card"
        >
          <span className="mt-0.5 grid size-7 shrink-0 place-content-center rounded-full bg-status-warning-bg text-icon-warning">
            <WarningCircle weight="fill" className="size-[18px]" />
          </span>
          <div className="grid gap-0.5">
            <p className="text-[14px] leading-5 font-medium text-text-primary">
              {m.account_mfa_required_title()}
            </p>
            <p className="text-callout text-text-secondary">
              {m.account_mfa_required_body()}
            </p>
          </div>
        </div>
      ) : null}

      <SettingsSection
        id="profile"
        title={m.account_profile_title()}
        description={m.account_profile_description()}
      >
        <dl className="grid gap-3 text-body">
          <div className="grid gap-0.5">
            <dt className="text-callout text-text-secondary">
              {m.auth_name()}
            </dt>
            <dd className="text-text-primary">{me.user.name}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-callout text-text-secondary">
              {m.auth_email()}
            </dt>
            <dd className="text-text-primary">{me.user.email}</dd>
          </div>
        </dl>
      </SettingsSection>

      <TwoFactorSection
        enabled={me.user.twoFactorEnabled}
        required={me.mfaEnrolmentRequired}
      />
    </div>
  )
}
