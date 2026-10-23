import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { PasswordInput } from '#/features/auth/password-input'
import { signOutClient } from '#/lib/sign-out'
import { m } from '#/paraglide/messages'
import { localizeHref } from '#/paraglide/runtime'
import { deleteMyAccountFn } from '#/server/fn/account'

import { emailMatches } from './account-logic'
import type { DeleteProof } from './account-logic'

/**
 * The address with a soft line break after `@` and each `.`, so a long address
 * wraps at its parts ("example.com") instead of inside a word.
 */
function emailBreaks(email: string) {
  const parts = email.split(/(?<=[@.])/)
  return parts.map((part, index) => (
    <React.Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <wbr /> : null}
    </React.Fragment>
  ))
}

/**
 * Two steps. Step 1 says what goes and what stays, and asks for the email.
 * Step 2 re-verifies the person (password, or a two-factor code), and is
 * skipped for SSO-only accounts without two-factor. On success the browser
 * signs out and lands on `/login?deleted=1`.
 */
export function DeleteAccountDialog({
  email,
  proof,
  open,
  onOpenChange,
}: {
  email: string
  proof: DeleteProof
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = React.useState<'confirm' | 'verify'>('confirm')
  const [typed, setTyped] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [kind, setKind] = React.useState<'totp' | 'backup'>('totp')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const emailId = React.useId()
  const codeId = React.useId()
  const passwordId = React.useId()
  const backup = kind === 'backup'
  const emailOk = emailMatches(typed, email)
  const needsProof = proof !== 'none'

  function reset() {
    setStep('confirm')
    setTyped('')
    setPassword('')
    setCode('')
    setKind('totp')
    setError(null)
  }

  function handleOpenChange(next: boolean) {
    if (pending) return
    if (!next) reset()
    onOpenChange(next)
  }

  async function remove() {
    setPending(true)
    setError(null)
    const confirmEmail = typed.trim()
    try {
      if (proof === 'password') {
        await deleteMyAccountFn({ data: { confirmEmail, password } })
      } else if (proof === 'code') {
        await deleteMyAccountFn({
          data: {
            confirmEmail,
            code: code.replace(/\s+/g, ''),
            kind,
          },
        })
      } else {
        await deleteMyAccountFn({ data: { confirmEmail } })
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : m.account_delete_failed(),
      )
      setPending(false)
      return
    }
    // The server has already removed the account and its sessions. End the
    // browser's side too, then start again from a clean page.
    await signOutClient().catch(() => undefined)
    queryClient.clear()
    window.location.assign(`${localizeHref('/login')}?deleted=1`)
  }

  function advance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!emailOk || pending) return
    if (step === 'confirm' && needsProof) {
      setStep('verify')
      return
    }
    void remove()
  }

  const proofReady =
    proof === 'password'
      ? password.length > 0
      : code.replace(/\s+/g, '').length > 0

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="delete-account-dialog">
        <form className="grid gap-5" onSubmit={advance}>
          {step === 'confirm' ? (
            <>
              <AlertDialogHeader className="place-items-start text-left">
                <AlertDialogTitle>
                  {m.account_delete_dialog_title()}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="grid gap-3">
                    <p>{m.account_delete_dialog_intro()}</p>
                    <ul className="grid list-disc gap-1 pl-5 text-text-primary marker:text-icon-muted">
                      <li>{m.account_delete_removed_sign_in()}</li>
                      <li>{m.account_delete_removed_access()}</li>
                      <li>{m.account_delete_removed_keys()}</li>
                    </ul>
                    <p>{m.account_delete_kept()}</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <FormField
                label={m.account_delete_type_email()}
                htmlFor={emailId}
                description={
                  <span
                    data-testid="delete-account-address"
                    className="block max-w-full rounded-[6px] bg-background-subtle px-2 py-1.5 font-mono text-[13px] leading-5 break-words text-text-primary"
                  >
                    {emailBreaks(email)}
                  </span>
                }
                error={error ?? undefined}
              >
                <Input
                  id={emailId}
                  name="confirmEmail"
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  value={typed}
                  disabled={pending}
                  data-testid="delete-account-email"
                  onChange={(event) => setTyped(event.target.value)}
                />
              </FormField>
            </>
          ) : (
            <>
              <AlertDialogHeader className="place-items-start text-left">
                <AlertDialogTitle>
                  {m.account_delete_verify_title()}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {proof === 'password'
                    ? m.account_delete_verify_password_help()
                    : m.account_delete_verify_code_help()}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {proof === 'password' ? (
                <FormField
                  label={m.auth_password()}
                  htmlFor={passwordId}
                  error={error ?? undefined}
                >
                  <PasswordInput
                    id={passwordId}
                    name="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    disabled={pending}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </FormField>
              ) : (
                <div className="grid gap-3">
                  <FormField
                    label={
                      backup
                        ? m.auth_two_factor_backup_code()
                        : m.auth_two_factor_code()
                    }
                    htmlFor={codeId}
                    hint={
                      backup
                        ? m.auth_two_factor_backup_hint()
                        : m.auth_two_factor_code_hint()
                    }
                    error={error ?? undefined}
                  >
                    <Input
                      key={kind}
                      id={codeId}
                      name="code"
                      inputMode={backup ? 'text' : 'numeric'}
                      autoComplete="one-time-code"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      value={code}
                      disabled={pending}
                      data-testid="delete-account-code"
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </FormField>
                  <button
                    type="button"
                    data-testid="delete-account-code-kind"
                    disabled={pending}
                    className="justify-self-start text-callout text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
                    onClick={() => {
                      setKind(backup ? 'totp' : 'backup')
                      setCode('')
                    }}
                  >
                    {backup
                      ? m.auth_two_factor_use_app()
                      : m.auth_two_factor_use_backup()}
                  </button>
                </div>
              )}
            </>
          )}

          <AlertDialogFooter className="gap-2">
            {step === 'verify' ? (
              <Button
                type="button"
                variant="quiet"
                disabled={pending}
                onClick={() => {
                  setStep('confirm')
                  setError(null)
                }}
              >
                {m.account_delete_back()}
              </Button>
            ) : (
              <AlertDialogCancel disabled={pending}>
                {m.shared_cancel()}
              </AlertDialogCancel>
            )}
            {step === 'confirm' && needsProof ? (
              <Button
                type="submit"
                variant="primary"
                disabled={!emailOk || pending}
                data-testid="delete-account-continue"
              >
                {m.account_delete_continue()}
              </Button>
            ) : (
              <Button
                type="submit"
                variant="destructive"
                loading={pending}
                disabled={
                  !emailOk || (step === 'verify' && !proofReady) || pending
                }
                data-testid="delete-account-confirm"
              >
                {m.account_delete_confirm()}
              </Button>
            )}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
