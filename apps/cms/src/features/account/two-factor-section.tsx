import * as React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ShieldCheck } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { CopyButton } from '#/components/ui/copy-button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { Tag } from '#/components/ui/tag'
import { PasswordInput } from '#/features/auth/password-input'
import { m } from '#/paraglide/messages'

import { useTwoFactor } from './use-two-factor'
import type { PasswordAction } from './use-two-factor'

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      data-testid="two-factor-error"
      className="text-callout text-text-error"
    >
      {children}
    </p>
  )
}

function PasswordStep({
  action,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  action: PasswordAction
  pending: boolean
  error: string | null
  onSubmit: (password: string) => void
  onCancel: () => void
}) {
  const [password, setPassword] = React.useState('')
  const label = {
    enable: m.account_two_factor_continue(),
    disable: m.account_two_factor_disable(),
    regenerate: m.account_two_factor_regenerate(),
  }[action]
  return (
    <form
      className="grid gap-4"
      data-testid="two-factor-password"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(password)
      }}
    >
      <FormField
        label={m.auth_password()}
        htmlFor="two-factor-password"
        description={m.account_two_factor_password_help()}
      >
        <PasswordInput
          id="two-factor-password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant={action === 'disable' ? 'destructive' : 'primary'}
          loading={pending}
        >
          {label}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {m.shared_cancel()}
        </Button>
      </div>
    </form>
  )
}

function VerifyStep({
  uri,
  secret,
  pending,
  error,
  onVerify,
  onCancel,
}: {
  uri: string
  secret: string
  pending: boolean
  error: string | null
  onVerify: (code: string) => void
  onCancel: () => void
}) {
  const [code, setCode] = React.useState('')
  return (
    <form
      className="grid gap-5"
      data-testid="two-factor-verify"
      onSubmit={(event) => {
        event.preventDefault()
        onVerify(code)
      }}
    >
      <p className="text-callout text-text-secondary">
        {m.account_two_factor_scan()}
      </p>
      <div className="flex flex-wrap items-start gap-5">
        <div
          className="rounded-control bg-white p-3"
          data-testid="two-factor-qr"
        >
          <QRCodeSVG value={uri} size={156} marginSize={0} />
        </div>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <span className="text-callout text-text-secondary">
            {m.account_two_factor_secret()}
          </span>
          <div className="flex items-center gap-1">
            <code
              data-testid="two-factor-secret"
              className="min-w-0 truncate rounded-[6px] bg-background-subtle px-2 py-1 font-mono text-[13px] text-text-primary"
            >
              {secret}
            </code>
            <CopyButton value={secret} aria-label={m.ui_copy()} />
          </div>
        </div>
      </div>
      <FormField
        label={m.auth_two_factor_code()}
        htmlFor="two-factor-enrol-code"
      >
        <Input
          id="two-factor-enrol-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </FormField>
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={pending} disabled={code.length < 6}>
          {m.account_two_factor_verify_enable()}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {m.shared_cancel()}
        </Button>
      </div>
    </form>
  )
}

function CodesStep({
  codes,
  enrolled,
  onDone,
}: {
  codes: string[]
  enrolled: boolean
  onDone: () => void
}) {
  return (
    <div className="grid gap-4" data-testid="two-factor-codes">
      <div className="grid gap-1">
        <p className="text-headline text-text-primary">
          {enrolled
            ? m.account_two_factor_enabled_title()
            : m.account_two_factor_new_codes_title()}
        </p>
        <p className="text-callout text-text-secondary">
          {m.account_two_factor_codes_help()}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-control bg-background-subtle p-3 font-mono text-[13px] text-text-primary">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <CopyButton
          value={codes.join('\n')}
          label={m.account_two_factor_copy_codes()}
          variant="secondary"
        />
        <Button type="button" onClick={onDone} data-testid="two-factor-done">
          {m.account_two_factor_saved()}
        </Button>
      </div>
    </div>
  )
}

/** Two-factor authentication: enable, disable, regenerate backup codes. */
export function TwoFactorSection({
  enabled,
  required,
}: {
  enabled: boolean
  /** An agency admin who must enrol before using the rest of the app. */
  required: boolean
}) {
  const tf = useTwoFactor()
  const { mode } = tf

  return (
    <SettingsSection
      id="two-factor"
      title={m.account_two_factor_title()}
      description={m.account_two_factor_description()}
      data-testid="two-factor-section"
    >
      {mode.kind === 'idle' ? (
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-[18px] text-icon-default" />
            <span className="text-body text-text-primary">
              {enabled ? m.account_two_factor_on() : m.account_two_factor_off()}
            </span>
            <Tag tone={enabled ? 'success' : required ? 'error' : 'neutral'}>
              {enabled
                ? m.account_two_factor_tag_on()
                : m.account_two_factor_tag_off()}
            </Tag>
          </div>
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => tf.begin('regenerate')}
                  data-testid="two-factor-regenerate"
                >
                  {m.account_two_factor_regenerate()}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => tf.begin('disable')}
                  data-testid="two-factor-disable"
                >
                  {m.account_two_factor_disable()}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => tf.begin('enable')}
                data-testid="two-factor-enable"
              >
                {m.account_two_factor_enable()}
              </Button>
            )}
          </div>
        </div>
      ) : mode.kind === 'password' ? (
        <PasswordStep
          action={mode.action}
          pending={tf.pending}
          error={tf.error}
          onSubmit={(password) => void tf.submitPassword(mode.action, password)}
          onCancel={tf.reset}
        />
      ) : mode.kind === 'verify' ? (
        <VerifyStep
          uri={mode.uri}
          secret={mode.secret}
          pending={tf.pending}
          error={tf.error}
          onVerify={(code) => void tf.verify(code)}
          onCancel={tf.reset}
        />
      ) : (
        <CodesStep
          codes={mode.backupCodes}
          enrolled={mode.enrolled}
          onDone={() => void tf.finish()}
        />
      )}
    </SettingsSection>
  )
}
