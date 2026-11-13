import { m } from '#/paraglide/messages'

/**
 * Better Auth's code when a session is refused because the person is blocked
 * (the `session.create` hook in `lib/auth.ts`). Password, social and SSO
 * sign-in all end with it, either as the error of the request or as the
 * `error` query value of a provider callback.
 */
export const ACCOUNT_BLOCKED_CODE = 'ACCOUNT_BLOCKED'

/** The copy for a failed sign-in. A blocked account never shows the reason. */
export function signInFailureMessage(failure: {
  code?: string
  message?: string
}) {
  if (failure.code === ACCOUNT_BLOCKED_CODE) return m.auth_account_blocked()
  return failure.message ?? m.auth_could_not_sign_in()
}

/**
 * Better Auth reports provider failures as a code on the callback URL (social
 * callbacks use underscores, Microsoft SSO spaces). The ones people actually
 * hit get real copy.
 */
export function providerErrorMessage(code: string | undefined) {
  if (!code) return null
  switch (code.replaceAll(' ', '_')) {
    case ACCOUNT_BLOCKED_CODE:
      return m.auth_account_blocked()
    case 'REGISTRATION_NOT_ALLOWED':
      return m.auth_registration_not_allowed()
    case 'account_not_linked':
      return m.auth_account_not_linked()
    default:
      return m.auth_could_not_sign_in()
  }
}
