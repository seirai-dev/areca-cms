import { isIP } from 'node:net'

import nodemailer from 'nodemailer'

import { MailConfigError } from './errors.ts'
import { isInsecureForHost } from './hosts.ts'
import type { MailConfig, MailMessage } from './types.ts'

/** Connection, greeting and socket timeout. */
export const MAIL_TIMEOUT_MS = 15_000

/**
 * nodemailer options for a configuration. STARTTLS is required when chosen,
 * implicit TLS wraps the socket, and `none` skips TLS entirely (only allowed
 * for private hosts, see `createMailTransport`). Certificates are always
 * verified.
 */
export function transportOptions(config: MailConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure === 'tls',
    requireTLS: config.secure === 'starttls',
    ignoreTLS: config.secure === 'none',
    ...(config.username
      ? { auth: { user: config.username, pass: config.password ?? '' } }
      : {}),
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2' as const,
      servername: isIP(config.host) ? undefined : config.host,
    },
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  }
}

export function createMailTransport(config: MailConfig) {
  if (isInsecureForHost(config)) {
    throw new MailConfigError('insecure_public_host', { host: config.host })
  }
  return nodemailer.createTransport(transportOptions(config))
}

/** Opens a connection, performs the handshake and authenticates. Sends nothing. */
export async function verifyMail(config: MailConfig): Promise<void> {
  const transporter = createMailTransport(config)
  try {
    await transporter.verify()
  } finally {
    transporter.close()
  }
}

export async function sendMail(
  config: MailConfig,
  message: MailMessage,
): Promise<{ messageId: string }> {
  const transporter = createMailTransport(config)
  try {
    const info = await transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo ?? config.replyTo ?? undefined,
      headers: message.headers,
    })
    return { messageId: info.messageId }
  } finally {
    transporter.close()
  }
}
