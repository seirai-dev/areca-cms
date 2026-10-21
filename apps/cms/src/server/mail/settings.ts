import { db } from '#/db'
import { mailSettings } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { ValidationError } from '#/server/content/errors'
import { createLogger } from '#/server/log'
import { encryptSecret } from '#/server/security/secret-encryption'
import {
  secretsEncryptionKey,
  secretsEncryptionKeyEnvName,
} from '#/server/security/secrets-key'

import {
  MAIL_PASSWORD_CONTEXT,
  MAIL_ROW_ID,
  chooseMailSource,
  decryptStoredPassword,
  invalidateMailConfig,
  loadMailSettingsRow,
  readEnvMail,
  validateMailConfig,
} from './config.ts'
import type { EnvMail, MailSettingsRow } from './config.ts'
import { logMailFailure, toMailFailure } from './errors.ts'
import { verifyMail } from './transport.ts'
import type {
  MailConfig,
  MailFailure,
  MailSecure,
  MailSource,
} from './types.ts'

const log = createLogger('mail')

export type MailSettingsInput = {
  host: string
  port: number
  secure: MailSecure
  username: string | null
  /** New password. Undefined or empty keeps the stored one. */
  password?: string
  /** Removes the stored password. */
  clearPassword?: boolean
  fromAddress: string
  replyTo: string | null
  /** The admin ran Verify connection on these exact values. */
  verified: boolean
}

/** Unsaved form values, for verifying before a save. */
export type MailDraft = Omit<MailSettingsInput, 'verified'>

export type MailSettingsStatus = ReturnType<typeof mailSettingsStatus>

export type MailVerifyResult =
  { ok: true } | { ok: false; failure: MailFailure }

/**
 * Admin DTO. Never contains the password, only whether one is stored. Pure, so
 * the shape can be tested without a database.
 */
export function mailSettingsStatus(input: {
  row: MailSettingsRow | null
  envMail: EnvMail | null
  encryptionReady: boolean
  encryptionKeyEnv: string
}) {
  const { row, envMail } = input
  const source: MailSource | 'none' = chooseMailSource(row, envMail) ?? 'none'
  return {
    source,
    settings: row
      ? {
          enabled: row.enabled,
          host: row.host,
          port: row.port,
          secure: row.secure,
          username: row.username,
          fromAddress: row.fromAddress,
          replyTo: row.replyTo,
          passwordSet: Boolean(row.encryptedPassword),
          lastVerifiedAt: row.lastVerifiedAt,
          updatedAt: row.updatedAt,
        }
      : null,
    env: envMail
      ? {
          host: envMail.host,
          port: envMail.port,
          secure: envMail.secure,
          username: envMail.username,
          from: envMail.from,
          replyTo: envMail.replyTo,
          passwordSet: envMail.password !== null,
        }
      : null,
    encryptionReady: input.encryptionReady,
    // Sent from the server so the client bundle never names a server secret
    // (see scripts/scan-client-bundle.mjs).
    encryptionKeyEnv: input.encryptionKeyEnv,
  }
}

/** Whether the values point at a different server or account than the stored ones. */
function connectionDiffers(
  row: MailSettingsRow | null,
  next: {
    host: string
    port: number
    secure: MailSecure
    username: string | null
  },
) {
  if (!row) return true
  return (
    next.host !== row.host ||
    next.port !== row.port ||
    next.secure !== row.secure ||
    next.username !== row.username
  )
}

export async function getMailSettingsStatus() {
  return mailSettingsStatus({
    row: await loadMailSettingsRow(),
    envMail: readEnvMail(env),
    encryptionReady: Boolean(secretsEncryptionKey()),
    encryptionKeyEnv: secretsEncryptionKeyEnvName(),
  })
}

/**
 * Stores the Mail tab settings and switches sending to them. Replaces the
 * environment SMTP settings entirely. `verified` records whether the admin ran
 * Verify connection on these values; without it the previous verification
 * timestamp is kept only when the connection itself did not change.
 */
export async function saveMailSettings(
  input: MailSettingsInput,
  actorId: string,
) {
  const row = await loadMailSettingsRow()
  const host = input.host.trim()
  const fromAddress = input.fromAddress.trim()
  const replyTo = input.replyTo?.trim() || null
  const username = input.username?.trim() || null

  const problems = validateMailConfig({
    host,
    port: input.port,
    secure: input.secure,
    from: fromAddress,
    replyTo,
  })
  if (problems.length > 0) {
    throw new ValidationError(
      problems.map(({ path, message }) => ({ path, message })),
    )
  }

  const newPassword = input.password || undefined
  let encryptedPassword = input.clearPassword
    ? null
    : (row?.encryptedPassword ?? null)
  if (newPassword) {
    const key = secretsEncryptionKey()
    if (!key) {
      throw new ValidationError([
        {
          path: 'password',
          message: m.server_mail_settings_key_missing({
            env: secretsEncryptionKeyEnvName(),
          }),
        },
      ])
    }
    encryptedPassword = encryptSecret(newPassword, key, MAIL_PASSWORD_CONTEXT)
  }

  const passwordChanged =
    Boolean(newPassword) ||
    (Boolean(input.clearPassword) && Boolean(row?.encryptedPassword))
  const connectionChanged =
    passwordChanged ||
    connectionDiffers(row, {
      host,
      port: input.port,
      secure: input.secure,
      username,
    })

  const now = new Date()
  const values = {
    enabled: true,
    host,
    port: input.port,
    secure: input.secure,
    username,
    encryptedPassword,
    fromAddress,
    replyTo,
    lastVerifiedAt: input.verified
      ? now
      : connectionChanged
        ? null
        : (row?.lastVerifiedAt ?? null),
    updatedBy: actorId,
    updatedAt: now,
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(mailSettings)
      .values({ id: MAIL_ROW_ID, ...values })
      .onConflictDoUpdate({ target: mailSettings.id, set: values })
    await audit(
      {
        organizationId: null,
        actorId,
        action: 'mail_settings.update',
        targetType: 'mail_settings',
        targetId: MAIL_ROW_ID,
        meta: {
          host,
          port: input.port,
          secure: input.secure,
          usernameSet: username !== null,
          passwordChanged,
          verified: input.verified,
        },
      },
      tx,
    )
  })
  invalidateMailConfig()
  return getMailSettingsStatus()
}

/** Switches sending back to the environment. Stored values are kept. */
export async function useEnvironmentMail(actorId: string) {
  const now = new Date()
  const values = { enabled: false, updatedBy: actorId, updatedAt: now }
  await db.transaction(async (tx) => {
    await tx
      .insert(mailSettings)
      .values({ id: MAIL_ROW_ID, ...values })
      .onConflictDoUpdate({ target: mailSettings.id, set: values })
    await audit(
      {
        organizationId: null,
        actorId,
        action: 'mail_settings.use_env',
        targetType: 'mail_settings',
        targetId: MAIL_ROW_ID,
        meta: {},
      },
      tx,
    )
  })
  invalidateMailConfig()
  return getMailSettingsStatus()
}

/**
 * The password to send with. An empty draft password keeps the stored one only
 * when host, port and username match the saved row, so a stored password is
 * never sent to a different server or account.
 */
export function draftPassword(
  draft: Pick<
    MailDraft,
    'host' | 'port' | 'username' | 'password' | 'clearPassword'
  >,
  row: Pick<
    MailSettingsRow,
    'host' | 'port' | 'username' | 'encryptedPassword'
  > | null,
  readStored: (encrypted: string | null) => string | null,
): string | null {
  if (draft.clearPassword) return null
  if (draft.password) return draft.password
  const sameServer =
    row !== null &&
    row.host === draft.host.trim() &&
    row.port === draft.port &&
    row.username === (draft.username?.trim() || null)
  return sameServer ? readStored(row.encryptedPassword) : null
}

/**
 * Builds a configuration from unsaved form values. See `draftPassword` for
 * when the stored password is reused.
 */
export async function draftToConfig(draft: MailDraft): Promise<MailConfig> {
  const row = await loadMailSettingsRow()
  const password = draftPassword(draft, row, decryptStoredPassword)
  return {
    source: 'settings',
    host: draft.host.trim(),
    port: draft.port,
    secure: draft.secure,
    username: draft.username?.trim() || null,
    password,
    from: draft.fromAddress.trim(),
    replyTo: draft.replyTo?.trim() || null,
  }
}

/** Handshake and authentication on the unsaved values. Sends nothing. */
export async function verifyMailDraft(
  draft: MailDraft,
): Promise<MailVerifyResult> {
  const host = draft.host.trim()
  let config: MailConfig | null = null
  try {
    config = await draftToConfig(draft)
    await verifyMail(config)
    return { ok: true }
  } catch (error) {
    const context = {
      host,
      port: draft.port,
      secure: draft.secure,
      secrets: [config?.password, draft.password],
    }
    const failure = toMailFailure(error, context)
    logMailFailure(log, failure, { ...context, kind: 'verify', error })
    return { ok: false, failure }
  }
}
