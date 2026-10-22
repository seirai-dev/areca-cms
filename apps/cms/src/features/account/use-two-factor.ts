import * as React from 'react'
import { useRouter } from '@tanstack/react-router'

import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

export type PasswordAction = 'enable' | 'disable' | 'regenerate'

export type TwoFactorMode =
  | { kind: 'idle' }
  | { kind: 'password'; action: PasswordAction }
  /** Enrolment: scan the code, then confirm with a first code. */
  | { kind: 'verify'; uri: string; secret: string; backupCodes: string[] }
  /** Backup codes, shown once. */
  | { kind: 'codes'; backupCodes: string[]; enrolled: boolean }

/** The shared secret from an `otpauth://` URI, for manual entry. */
export function secretFromUri(uri: string) {
  try {
    return new URL(uri).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

/**
 * Two-factor enrolment and management for the signed-in user. Every step
 * reports failures inline; enabling and disabling swap the session (Better
 * Auth issues a fresh one), so finishing re-runs the route loaders to pick up
 * the new `twoFactorEnabled`.
 */
export function useTwoFactor() {
  const router = useRouter()
  const [mode, setMode] = React.useState<TwoFactorMode>({ kind: 'idle' })
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  function reset() {
    setMode({ kind: 'idle' })
    setError(null)
    setPending(false)
  }

  function begin(action: PasswordAction) {
    setError(null)
    setMode({ kind: 'password', action })
  }

  async function submitPassword(action: PasswordAction, password: string) {
    setPending(true)
    setError(null)
    // Accounts that only sign in through a provider have no password; Better
    // Auth then skips the check, so an empty field is sent as "not provided".
    const body = { password: password || undefined } as { password: string }
    try {
      if (action === 'enable') {
        const result = await authClient.twoFactor.enable(body)
        const data = result.data
        if (result.error || !data || !('totpURI' in data)) {
          setError(result.error?.message ?? m.account_two_factor_failed())
          return
        }
        setMode({
          kind: 'verify',
          uri: data.totpURI,
          secret: secretFromUri(data.totpURI),
          backupCodes: data.backupCodes,
        })
      } else if (action === 'regenerate') {
        const result = await authClient.twoFactor.generateBackupCodes(body)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: a response without codes is treated as failure
        if (result.error || !result.data?.backupCodes) {
          setError(result.error?.message ?? m.account_two_factor_failed())
          return
        }
        setMode({
          kind: 'codes',
          backupCodes: result.data.backupCodes,
          enrolled: false,
        })
      } else {
        const result = await authClient.twoFactor.disable(body)
        if (result.error) {
          setError(result.error.message ?? m.account_two_factor_failed())
          return
        }
        reset()
        await router.invalidate()
      }
    } finally {
      setPending(false)
    }
  }

  async function verify(code: string) {
    if (mode.kind !== 'verify') return
    setPending(true)
    setError(null)
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: code.replace(/\s+/g, ''),
      })
      if (result.error) {
        setError(result.error.message ?? m.auth_two_factor_invalid_code())
        return
      }
      setMode({ kind: 'codes', backupCodes: mode.backupCodes, enrolled: true })
    } finally {
      setPending(false)
    }
  }

  async function finish() {
    reset()
    await router.invalidate()
  }

  return { mode, error, pending, begin, submitPassword, verify, finish, reset }
}
