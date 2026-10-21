import type { MailSecure } from '#/lib/types'

export type { MailSecure } from '#/lib/types'

/** Where the active SMTP settings come from. */
export type MailSource = 'settings' | 'env'

/** Resolved SMTP configuration. The password is only ever held in memory. */
export type MailConfig = {
  source: MailSource
  host: string
  port: number
  secure: MailSecure
  username: string | null
  password: string | null
  /** Bare address or `"Name" <address>`. */
  from: string
  replyTo: string | null
}

export type MailMessage = {
  /** Already formatted `From` header, see `formatFrom`. */
  from: string
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string | null
  headers?: Record<string, string>
}

export type MailFailureCode =
  | 'not_configured'
  | 'auth_failed'
  | 'connection_failed'
  | 'timeout'
  | 'tls_failed'
  | 'starttls_unsupported'
  | 'sender_rejected'
  | 'recipient_rejected'
  | 'rate_limited'
  | 'insecure_public_host'
  | 'password_unreadable'
  | 'unknown'

/** A send failure reduced to something safe to show and store. */
export type MailFailure = {
  code: MailFailureCode
  /** Values for the code's message placeholders. */
  params: Record<string, string>
  /** Redacted technical detail, at most 500 characters. */
  detail: string
  retryable: boolean
  /** Outbox id, or a generated reference for sends outside the outbox. */
  ref: string
  smtpCode?: number
  command?: string
  /** Redacted SMTP response, at most 200 characters. */
  response?: string
}

/** Delivery attempts per outbox row, including the immediate try. */
export const MAIL_MAX_ATTEMPTS = 3
