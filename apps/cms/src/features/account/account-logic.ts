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

export type EmailChangeOutcome =
  | { kind: 'changed' }
  | { kind: 'failed'; reason: 'expired' | 'taken' | 'not_allowed' | 'invalid' }

const EMAIL_CHANGE_FAILURES: Record<
  string,
  Extract<EmailChangeOutcome, { kind: 'failed' }>['reason']
> = {
  TOKEN_EXPIRED: 'expired',
  EMAIL_TAKEN: 'taken',
  EMAIL_CHANGE_NOT_ALLOWED: 'not_allowed',
}

/**
 * The confirmation link returns to `/account?emailChange=done`, with
 * `error=<code>` added when the change did not apply.
 */
export function emailChangeOutcome(
  searchString: string,
): EmailChangeOutcome | null {
  const params = new URLSearchParams(searchString)
  if (params.get('emailChange') !== 'done') return null
  const error = params.get('error')
  if (!error) return { kind: 'changed' }
  return { kind: 'failed', reason: EMAIL_CHANGE_FAILURES[error] ?? 'invalid' }
}

/** The search object without the link's parameters, so a refresh is quiet. */
export function withoutEmailChangeParams<T extends Record<string, unknown>>(
  search: T,
): Omit<T, 'emailChange' | 'error'> {
  const { emailChange: _emailChange, error: _error, ...rest } = search
  return rest
}
