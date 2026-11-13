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

/** How long an unused pooled connection stays open. */
const POOL_IDLE_MS = 10_000

type Pooled = {
  transporter: ReturnType<typeof nodemailer.createTransport>
  active: number
  idle: ReturnType<typeof setTimeout> | null
  retired: boolean
}

/** One pooled transport per configuration, so a batch of mails shares its connections. */
const pools = new Map<string, Pooled>()

function closeIfDone(key: string, pooled: Pooled) {
  if (pooled.active > 0 || !pooled.retired) return
  if (pools.get(key) === pooled) pools.delete(key)
  pooled.transporter.close()
}

function acquire(config: MailConfig): { key: string; pooled: Pooled } {
  if (isInsecureForHost(config)) {
    throw new MailConfigError('insecure_public_host', { host: config.host })
  }
  const options = transportOptions(config)
  const key = JSON.stringify(options)
  let pooled = pools.get(key)
  if (!pooled) {
    pooled = {
      transporter: nodemailer.createTransport({
        ...options,
        pool: true,
        maxConnections: 2,
      }),
      active: 0,
      idle: null,
      retired: false,
    }
    pools.set(key, pooled)
  }
  if (pooled.idle) clearTimeout(pooled.idle)
  pooled.idle = null
  pooled.active++
  return { key, pooled }
}

/**
 * Hands the transport back. A failed send retires it, so the next send opens
 * fresh connections, as an unpooled send would. An unused one closes after
 * POOL_IDLE_MS.
 */
function release(key: string, pooled: Pooled, failed: boolean) {
  pooled.active--
  if (failed && pools.get(key) === pooled) pools.delete(key)
  if (failed) pooled.retired = true
  if (pooled.retired) return closeIfDone(key, pooled)
  if (pooled.active > 0) return
  pooled.idle = setTimeout(() => {
    pooled.retired = true
    closeIfDone(key, pooled)
  }, POOL_IDLE_MS)
  pooled.idle.unref()
}

/** Closes every pooled connection (shutdown, tests). */
export function closeMailPools() {
  for (const [key, pooled] of pools) {
    if (pooled.idle) clearTimeout(pooled.idle)
    pooled.retired = true
    closeIfDone(key, pooled)
  }
}

/**
 * Sends one message over the pooled transport of its configuration. Mails
 * sent close together (an outbox batch) reuse the connection and its TLS and
 * AUTH handshake.
 */
export async function sendMail(
  config: MailConfig,
  message: MailMessage,
): Promise<{ messageId: string }> {
  const { key, pooled } = acquire(config)
  let failed = true
  try {
    const info = await pooled.transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo ?? config.replyTo ?? undefined,
      headers: message.headers,
    })
    failed = false
    return { messageId: info.messageId }
  } finally {
    release(key, pooled, failed)
  }
}
