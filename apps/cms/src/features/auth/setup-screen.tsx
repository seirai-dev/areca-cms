import * as React from 'react'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import type { AuthMethods } from '#/lib/auth-providers'
import { useBranding } from '#/lib/use-branding'
import { m } from '#/paraglide/messages'

import { AuthError, AuthHeading, AuthShell } from './auth-shell'
import { PasswordInput } from './password-input'
import { useCompleteSetup, useHydrated } from './use-auth-forms'

/**
 * `/setup` (brief §3.1): "Welcome to {app}" / "Create the first admin
 * account." Name, email, password with a show/hide eye, the setup token
 * (from `SETUP_TOKEN` or the server log), "Create admin account". Only
 * reachable while no accounts exist.
 */
export function SetupScreen({ methods }: { methods: AuthMethods }) {
  const branding = useBranding()
  const ready = useHydrated()
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [setupToken, setSetupToken] = React.useState('')
  const { complete, error, pending } = useCompleteSetup(methods.emailPassword)

  return (
    <AuthShell
      footer={
        <span className="text-caption font-normal text-text-muted">
          {m.auth_setup_footnote()}
        </span>
      }
    >
      <AuthHeading
        title={m.auth_welcome_to({ appName: branding.appName })}
        description={m.auth_setup_subtitle()}
      />
      <form
        className="mt-7 grid gap-4"
        method="post"
        data-testid="setup-form"
        data-ready={ready ? 'true' : 'false'}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void complete({ name, email, password, setupToken })
        }}
      >
        <FormField label={m.auth_name()} htmlFor="name">
          <Input
            id="name"
            name="name"
            inputSize="lg"
            autoComplete="name"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={m.auth_email()} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            inputSize="lg"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField
          label={m.auth_password()}
          htmlFor="password"
          hint={m.auth_password_hint()}
        >
          <PasswordInput
            id="password"
            name="password"
            inputSize="lg"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <FormField
          label={m.auth_setup_token()}
          htmlFor="setup-token"
          hint={m.auth_setup_token_hint()}
        >
          <Input
            id="setup-token"
            name="setupToken"
            inputSize="lg"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
          />
        </FormField>
        {error ? <AuthError>{error}</AuthError> : null}
        <Button
          type="submit"
          size="lg"
          className="mt-1 w-full"
          disabled={!ready}
          loading={pending}
        >
          {m.auth_create_admin_account()}
        </Button>
      </form>
    </AuthShell>
  )
}
