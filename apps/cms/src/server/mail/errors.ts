import { m } from '#/paraglide/messages'
import {
  collectSecretValues,
  newErrorRef,
  redactError,
  redactString,
} from '#/server/log'
import type { Logger } from '#/server/log'

import { MAIL_MAX_ATTEMPTS } from './types.ts'
import type { MailFailure, MailFailureCode, MailSecure } from './types.ts'

/** Configuration problems detected before any SMTP traffic. */
export type MailConfigErrorCode =
  'not_configured' | 'password_unreadable' | 'insecure_public_host'

export class MailConfigError extends Error {
  readonly code: MailConfigErrorCode
  readonly params: Record<string, string>
  constructor(code: MailConfigErrorCode, params: Record<string, string> = {}) {
    super(code)
    this.name = 'MailConfigError'
    this.code = code
    this.params = params
  }
}

export type MailErrorContext = {
  host?: string
  port?: number
  secure?: MailSecure
  from?: string
  to?: string
  /** Outbox row id. A reference is generated when absent. */
  outboxId?: string
  /** Extra values to scrub (e.g. a password that is not in the environment). */
  secrets?: readonly (string | null | undefined)[]
}

/** Nodemailer and Node errors carry these fields; all are optional. */
type TransportError = {
  code?: unknown
  responseCode?: unknown
  command?: unknown
  response?: unknown
  message?: unknown
}

const RETRYABLE: ReadonlySet<MailFailureCode> = new Set([
  'connection_failed',
  'timeout',
  'rate_limited',
  'unknown',
])

const CONNECTION_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EDNS',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ESOCKET',
])

const TLS_CODE =
  /^(CERT_|ERR_TLS_|ERR_SSL_|ERR_OSSL_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_|EPROTO$)/

const REASON_MAX = 120
const REPLY_MAX = 200
const DETAIL_MAX = 500

/**
 * Turns anything thrown while talking to an SMTP server into a failure with a
 * code, placeholder values, retry flag and redacted technical detail. Pure
 * apart from generating a reference when no outbox id is given.
 */
export function toMailFailure(
  error: unknown,
  ctx: MailErrorContext = {},
): MailFailure {
  const secrets = scrubList(ctx.secrets)
  const ref = ctx.outboxId ?? newErrorRef()

  if (error instanceof MailConfigError) {
    return {
      code: error.code,
      params: error.params,
      detail: redactString(error.message, secrets).slice(0, DETAIL_MAX),
      retryable: false,
      ref,
    }
  }

  const transport = (error ?? {}) as TransportError
  const code = typeof transport.code === 'string' ? transport.code : undefined
  const smtpCode =
    typeof transport.responseCode === 'number'
      ? transport.responseCode
      : undefined
  const command =
    typeof transport.command === 'string' ? transport.command : undefined
  const response =
    typeof transport.response === 'string' ? transport.response : undefined
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error'

  const { code: mailCode, params } = classify({
    code,
    smtpCode,
    command,
    message,
    response: response ?? '',
    host: ctx.host ?? '',
    port: ctx.port,
    from: ctx.from ?? '',
    to: ctx.to ?? '',
    reply: redactString(response ?? message, secrets).slice(0, REPLY_MAX),
    ref,
  })

  return {
    code: mailCode,
    params,
    detail: redactString(
      [code, smtpCode, command, message].filter(Boolean).join(' | '),
      secrets,
    ).slice(0, DETAIL_MAX),
    retryable: RETRYABLE.has(mailCode),
    ref,
    smtpCode,
    command,
    response: response
      ? redactString(response, secrets).slice(0, REPLY_MAX)
      : undefined,
  }
}

function scrubList(values: MailErrorContext['secrets']) {
  return [
    ...collectSecretValues(),
    ...(values ?? []).filter((value): value is string => Boolean(value)),
  ]
}

type ClassifyInput = {
  code?: string
  smtpCode?: number
  command?: string
  message: string
  response: string
  host: string
  port?: number
  from: string
  to: string
  reply: string
  ref: string
}

function classify(input: ClassifyInput): {
  code: MailFailureCode
  params: Record<string, string>
} {
  const { code, smtpCode, command, message, host } = input
  const text = `${message} ${input.response}`

  if (code === 'EAUTH' || smtpCode === 535) {
    return { code: 'auth_failed', params: {} }
  }
  // nodemailer reports a refused STARTTLS as ETLS on the STARTTLS command, and
  // a required-but-missing STARTTLS as ECONNECTION on EHLO.
  if (
    (code === 'ETLS' && command === 'STARTTLS') ||
    (code === 'ECONNECTION' && command === 'EHLO' && /STARTTLS/.test(text))
  ) {
    return { code: 'starttls_unsupported', params: { host } }
  }
  if (isTlsError(code, text)) {
    const reason = code && TLS_CODE.test(code) ? code : message
    return {
      code: 'tls_failed',
      params: { host, reason: reason.slice(0, REASON_MAX) },
    }
  }
  if (command === 'MAIL FROM' && isRejection(smtpCode)) {
    return { code: 'sender_rejected', params: { from: input.from } }
  }
  if (command === 'RCPT TO' && isRejection(smtpCode)) {
    return {
      code: 'recipient_rejected',
      params: { to: input.to, reply: input.reply },
    }
  }
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) {
    return { code: 'timeout', params: { host } }
  }
  if (
    smtpCode === 421 ||
    smtpCode === 450 ||
    smtpCode === 451 ||
    smtpCode === 452 ||
    /too many/i.test(text)
  ) {
    return { code: 'rate_limited', params: {} }
  }
  if (code && CONNECTION_CODES.has(code)) {
    return {
      code: 'connection_failed',
      params: {
        host,
        port: input.port === undefined ? '' : String(input.port),
      },
    }
  }
  return { code: 'unknown', params: { reply: input.reply, id: input.ref } }
}

function isTlsError(code: string | undefined, text: string) {
  return (
    code === 'ETLS' ||
    (code !== undefined && TLS_CODE.test(code)) ||
    /wrong version number|certificate|SSL routines|TLS handshake/i.test(text)
  )
}

function isRejection(smtpCode: number | undefined) {
  return smtpCode !== undefined && smtpCode >= 500 && smtpCode < 600
}

/** The localized sentence for a failure. Placeholder values come from `params`. */
export function mailFailureMessage(
  failure: Pick<MailFailure, 'code' | 'params'>,
): string {
  const p: Partial<Record<string, string>> = failure.params
  switch (failure.code) {
    case 'not_configured':
      return m.server_mail_error_not_configured()
    case 'auth_failed':
      return m.server_mail_error_auth_failed()
    case 'connection_failed':
      return m.server_mail_error_connection_failed({
        host: p.host ?? '',
        port: p.port ?? '',
      })
    case 'timeout':
      return m.server_mail_error_timeout({ host: p.host ?? '' })
    case 'tls_failed':
      return m.server_mail_error_tls_failed({
        host: p.host ?? '',
        reason: p.reason ?? '',
      })
    case 'starttls_unsupported':
      return m.server_mail_error_starttls_unsupported({ host: p.host ?? '' })
    case 'sender_rejected':
      return m.server_mail_error_sender_rejected({ from: p.from ?? '' })
    case 'recipient_rejected':
      return m.server_mail_error_recipient_rejected({
        to: p.to ?? '',
        reply: p.reply ?? '',
      })
    case 'rate_limited':
      return m.server_mail_error_rate_limited()
    case 'insecure_public_host':
      return m.server_mail_error_insecure_public_host({ host: p.host ?? '' })
    case 'password_unreadable':
      return m.server_mail_error_password_unreadable()
    case 'unknown':
      return m.server_mail_error_unknown({
        reply: p.reply ?? '',
        id: p.id ?? '',
      })
  }
}

export type MailLogContext = MailErrorContext & {
  /** Email kind or event key, e.g. `invitation` or `test`. */
  kind?: string
  /** 1-based delivery attempt. */
  attempt?: number
  /** Original thrown value, redacted before it is logged. */
  error?: unknown
}

/**
 * One structured line per failed send: `warn` while a retry is still
 * scheduled, `error` once the send has given up.
 */
export function logMailFailure(
  logger: Logger,
  failure: MailFailure,
  ctx: MailLogContext = {},
) {
  // Verify and test sends are one-off checks; only outbox rows are retried.
  const oneOff = ctx.kind === 'verify' || ctx.kind === 'test'
  const retrying =
    !oneOff && failure.retryable && (ctx.attempt ?? 1) < MAIL_MAX_ATTEMPTS
  const fields = {
    code: failure.code,
    smtpCode: failure.smtpCode,
    command: failure.command,
    response: failure.response,
    host: ctx.host,
    port: ctx.port,
    secure: ctx.secure,
    outboxId: failure.ref,
    kind: ctx.kind,
    attempt: ctx.attempt,
    err:
      ctx.error === undefined
        ? undefined
        : redactError(ctx.error, scrubList(ctx.secrets)),
  }
  const message = oneOff
    ? 'mail check failed'
    : retrying
      ? 'mail send failed, will retry'
      : 'mail send failed'
  if (retrying) logger.warn(message, fields)
  else logger.error(message, fields)
}
