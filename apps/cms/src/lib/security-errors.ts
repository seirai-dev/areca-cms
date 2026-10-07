import { m } from '#/paraglide/messages'

/**
 * Typed security errors shared by the server guards and the UI.
 *
 * Server functions only ship an Error's `message` to the client, so the code
 * travels as a message prefix (`MFA_REQUIRED: ...`) and `securityErrorCode`
 * reads it back from either the original error or the deserialised one.
 */
export const MFA_REQUIRED = 'MFA_REQUIRED'
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED'

export type SecurityErrorCode = typeof MFA_REQUIRED | typeof REAUTH_REQUIRED

export class SecurityError extends Error {
  readonly status = 403
  readonly code: SecurityErrorCode
  constructor(code: SecurityErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'SecurityError'
    this.code = code
  }
}

export class MfaRequiredError extends SecurityError {
  constructor(message: string = m.server_mfa_required()) {
    super(MFA_REQUIRED, message)
  }
}

export class ReauthRequiredError extends SecurityError {
  constructor(message: string = m.server_reauth_required()) {
    super(REAUTH_REQUIRED, message)
  }
}

export function securityErrorCode(error: unknown): SecurityErrorCode | null {
  if (!(error instanceof Error)) return null
  const code = (error as { code?: unknown }).code
  if (code === MFA_REQUIRED || code === REAUTH_REQUIRED) return code
  if (error.message.startsWith(`${MFA_REQUIRED}:`)) return MFA_REQUIRED
  if (error.message.startsWith(`${REAUTH_REQUIRED}:`)) return REAUTH_REQUIRED
  return null
}

/** The human part of a security error's message, without the code prefix. */
export function stripSecurityCode(message: string) {
  return message.replace(/^(MFA_REQUIRED|REAUTH_REQUIRED):\s*/, '')
}
