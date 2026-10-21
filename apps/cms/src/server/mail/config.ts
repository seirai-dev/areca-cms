import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { mailSettings } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { decryptSecret } from '#/server/security/secret-encryption'
import { secretsEncryptionKey } from '#/server/security/secrets-key'

import { MailConfigError, mailFailureMessage } from './errors.ts'
import { isMailAddress } from './headers.ts'
import { defaultSecureFor, isInsecureForHost } from './hosts.ts'
import type { MailConfig, MailSecure, MailSource } from './types.ts'

export const MAIL_ROW_ID = 'default'
export const MAIL_PASSWORD_CONTEXT = 'mail-settings:smtp-password'
const CACHE_TTL_MS = 30_000

export type MailSettingsRow = typeof mailSettings.$inferSelect

/** Env-sourced SMTP values, as parsed by `#/env`. */
export type EnvSmtp = {
  SMTP_HOST?: string
  SMTP_PORT?: number
  SMTP_FROM?: string
  SMTP_USER?: string
  SMTP_PASSWORD?: string
  SMTP_SECURE?: MailSecure
  SMTP_REPLY_TO?: string
}

/** A complete environment configuration (host, port and from present). */
export type EnvMail = Omit<MailConfig, 'source'>

export function readEnvMail(values: EnvSmtp): EnvMail | null {
  const { SMTP_HOST: host, SMTP_PORT: port, SMTP_FROM: from } = values
  if (!host || !port || !from) return null
  return {
    host,
    port,
    secure: values.SMTP_SECURE ?? defaultSecureFor(host),
    username: values.SMTP_USER ?? null,
    password: values.SMTP_PASSWORD ?? null,
    from,
    replyTo: values.SMTP_REPLY_TO ?? null,
  }
}

type SettingsSourceFields = Pick<
  MailSettingsRow,
  'enabled' | 'host' | 'port' | 'fromAddress'
>

/** Which source is in effect. Mail settings replace the environment entirely. */
export function chooseMailSource(
  row: SettingsSourceFields | null,
  envMail: EnvMail | null,
): MailSource | null {
  if (row?.enabled && row.host && row.port && row.fromAddress) return 'settings'
  if (envMail) return 'env'
  return null
}

/**
 * Pure precedence rule: enabled and complete settings, then the environment,
 * else nothing. `readPassword` decrypts the stored password.
 */
export function pickMailConfig(
  row: MailSettingsRow | null,
  envMail: EnvMail | null,
  readPassword: (encrypted: string) => string | null,
): MailConfig | null {
  if (row?.enabled && row.host && row.port && row.fromAddress) {
    return {
      source: 'settings',
      host: row.host,
      port: row.port,
      secure: row.secure ?? defaultSecureFor(row.host),
      username: row.username,
      password: row.encryptedPassword
        ? readPassword(row.encryptedPassword)
        : null,
      from: row.fromAddress,
      replyTo: row.replyTo,
    }
  }
  if (envMail) return { ...envMail, source: 'env' }
  return null
}

export type MailProblem = {
  path: 'host' | 'port' | 'secure' | 'from' | 'replyTo'
  message: string
}

/**
 * Checks a configuration before it is saved or used. Returns an empty list
 * when it is valid. Messages are localized.
 */
export function validateMailConfig(config: {
  host: string
  port: number
  secure: MailSecure
  from: string
  replyTo: string | null
}): MailProblem[] {
  const problems: MailProblem[] = []
  const host = config.host.trim()
  if (!host) {
    problems.push({
      path: 'host',
      message: m.server_mail_settings_host_required(),
    })
  }
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65_535
  ) {
    problems.push({
      path: 'port',
      message: m.server_mail_settings_port_invalid(),
    })
  }
  if (!isMailAddress(config.from)) {
    problems.push({
      path: 'from',
      message: m.server_mail_settings_from_invalid(),
    })
  }
  if (config.replyTo && !isMailAddress(config.replyTo)) {
    problems.push({
      path: 'replyTo',
      message: m.server_mail_settings_reply_to_invalid(),
    })
  }
  if (host && isInsecureForHost({ host, secure: config.secure })) {
    problems.push({
      path: 'secure',
      message: mailFailureMessage({
        code: 'insecure_public_host',
        params: { host },
      }),
    })
  }
  return problems
}

/** Decrypts a stored password, or reports it as unreadable. */
export function decryptStoredPassword(encrypted: string | null): string | null {
  if (!encrypted) return null
  const key = secretsEncryptionKey()
  if (!key) throw new MailConfigError('password_unreadable')
  try {
    return decryptSecret(encrypted, key, MAIL_PASSWORD_CONTEXT)
  } catch {
    throw new MailConfigError('password_unreadable')
  }
}

export async function loadMailSettingsRow(): Promise<MailSettingsRow | null> {
  const rows = await db
    .select()
    .from(mailSettings)
    .where(eq(mailSettings.id, MAIL_ROW_ID))
    .limit(1)
  return rows.at(0) ?? null
}

let cache: { value: MailConfig | null; expiresAt: number } | null = null

/**
 * The SMTP configuration to send with, or null when sending is off. Cached for
 * 30 seconds per process; saves call `invalidateMailConfig()`.
 */
export async function resolveMailConfig(): Promise<MailConfig | null> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value
  const row = await loadMailSettingsRow()
  const value = pickMailConfig(row, readEnvMail(env), decryptStoredPassword)
  cache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

export function invalidateMailConfig() {
  cache = null
}
