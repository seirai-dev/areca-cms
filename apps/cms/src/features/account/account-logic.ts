/**
 * Pure rules for the account page: no i18n, no network. Components turn the
 * codes returned here into copy.
 */

/** Better Auth's default password policy (`minPasswordLength`, `maxPasswordLength`). */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export type PasswordChangeFields = {
  current: string
  next: string
  confirm: string
}

export type PasswordChangeError =
  'current_required' | 'too_short' | 'too_long' | 'mismatch'

export type PasswordChangeErrors = Partial<
  Record<keyof PasswordChangeFields, PasswordChangeError>
>

export function validatePasswordChange(
  fields: PasswordChangeFields,
): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {}
  if (!fields.current) errors.current = 'current_required'
  if (fields.next.length < PASSWORD_MIN_LENGTH) {
    errors.next = 'too_short'
  } else if (fields.next.length > PASSWORD_MAX_LENGTH) {
    errors.next = 'too_long'
  }
  if (fields.confirm !== fields.next) errors.confirm = 'mismatch'
  return errors
}

/** Save is enabled only for a non-empty name that differs from the saved one. */
export function canSaveName(draft: string, saved: string) {
  const next = draft.trim()
  return next.length > 0 && next !== saved.trim()
}

export type DeleteProof = 'password' | 'code' | 'none'

/**
 * What proves the person is who they say before their account is deleted.
 * Mirrors `verifySelfDeletion` on the server: a password wins when the account
 * has one, otherwise a two-factor code when two-factor is on, otherwise only
 * the typed email (SSO-only accounts without two-factor).
 */
export function deleteProofFor(account: {
  hasPassword: boolean
  twoFactorEnabled: boolean
}): DeleteProof {
  if (account.hasPassword) return 'password'
  if (account.twoFactorEnabled) return 'code'
  return 'none'
}

/** The server compares emails case-insensitively after trimming. */
export function emailMatches(typed: string, email: string) {
  return typed.trim().toLowerCase() === email.trim().toLowerCase()
}
