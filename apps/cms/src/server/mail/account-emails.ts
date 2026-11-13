/**
 * Account emails: password reset, verification, security notices and
 * membership changes. They always send (no preference), go to the address on
 * the account, and are rendered in the account's language.
 */
import { randomInt } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor } from '#/db'
import { account, user, verification } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { NotFoundError } from '#/server/content/errors'
import { createLogger } from '#/server/log'
import { encryptSecret } from '#/server/security/secret-encryption'
import { secretsEncryptionKey } from '#/server/security/secrets-key'
import {
  hashedVerificationIdentifier,
  verificationIdentifierForms,
} from '#/server/security/verification-identifiers'

import { isMailConfigured } from './config.ts'
import { enqueueEmail, sendNow } from './outbox.ts'
import type { EnqueuedEmail, SendResult } from './outbox.ts'
import { PARAMS_SECRET_CONTEXT } from './render/templates/password-reset.ts'
import { mailLocale } from './render/types.ts'

export type AccountEmailKind =
  | 'password_reset'
  | 'password_reset_sso'
  | 'verify_email'
  | 'password_changed'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'membership_removed'
  | 'membership_role_changed'
  | 'membership_added'
  | 'agency_admin_granted'
  | 'agency_admin_revoked'
  | 'account_deleted'
  | 'two_factor_reset'

export type QueuedEmail = { status: 'queued'; id: string }

/** Better Auth's reset token lifetime, mirrored for the admin-triggered reset. */
const RESET_TTL_MS = 60 * 60 * 1000
const RESET_TOKEN_LENGTH = 24
const TOKEN_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const PROVIDER_NAMES: Record<string, string> = {
  microsoft: 'Microsoft',
  google: 'Google',
  github: 'GitHub',
  discord: 'Discord',
}

const log = createLogger('mail')

/**
 * Queues an account email to a user. Skips (returns null) when mail isn't
 * configured or the account is gone. `immediate` tries the send right away,
 * which never happens inside a transaction: pass `connection` to enqueue with
 * the caller's transaction and let the worker send it after commit.
 */
export async function sendAccountEmail(input: {
  kind: AccountEmailKind
  userId: string
  params?: Record<string, unknown>
  renderParams?: Record<string, unknown>
  immediate?: boolean
  connection?: DbExecutor
}): Promise<SendResult | QueuedEmail | null> {
  const queued = await queueAccountEmail({
    ...input,
    immediate: input.immediate && !input.connection,
  })
  if (!queued) return null
  if (queued.claimedAttempt === undefined) {
    return { status: 'queued', id: queued.id }
  }
  return sendNow(queued.id, {
    renderParams: input.renderParams,
    claimedAttempt: queued.claimedAttempt,
  })
}

/**
 * Inserts the email. `immediate` means the caller sends it right after this
 * returns, so the row is claimed from the start (see `enqueueEmail`).
 */
async function queueAccountEmail(input: {
  kind: AccountEmailKind
  userId: string
  params?: Record<string, unknown>
  renderParams?: Record<string, unknown>
  immediate?: boolean
  connection?: DbExecutor
}): Promise<EnqueuedEmail | null> {
  if (!(await isMailConfigured())) {
    log.info('account email skipped: mail is not configured', {
      kind: input.kind,
      userId: input.userId,
    })
    return null
  }
  const reader = input.connection ?? db
  const recipient = (
    await reader
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
  ).at(0)
  if (!recipient) return null
  return enqueueEmail(
    {
      kind: input.kind,
      template: input.kind,
      to: recipient.email,
      params: { userId: input.userId, ...input.params },
      renderParams: input.renderParams,
      locale: mailLocale(recipient.locale),
      userId: input.userId,
      immediate: input.immediate,
    },
    input.connection,
  )
}

/**
 * Better Auth's `sendResetPassword`. The reset link goes to accounts with a
 * password. Accounts that only sign in through SSO get a pointer to their
 * provider instead, and the reset token is removed so it cannot be used.
 */
export async function deliverPasswordReset(input: {
  user: { id: string; email: string }
  token: string
}): Promise<SendResult | null> {
  const outcome = await deliverReset(input.user.id, input.token)
  return outcome?.result ?? null
}

/**
 * Admin "Send reset link". Creates the reset token the way Better Auth does
 * (identifier `reset-password:<token>`, valid one hour) and delivers it.
 * `sso` is true when the account has no password and got the provider email.
 */
export async function sendPasswordResetLink(
  userId: string,
  actorId: string,
): Promise<{ sso: boolean; result: SendResult } | null> {
  const target = (
    await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  if (!target) throw new NotFoundError(m.server_user_not_found())
  if (!(await isMailConfigured())) return null

  const token = newResetToken()
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    // Stored the way Better Auth stores its own reset tokens.
    identifier: hashedVerificationIdentifier(`reset-password:${token}`),
    value: userId,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  })
  const outcome = await deliverReset(userId, token)
  await audit({
    organizationId: null,
    actorId,
    action: 'user.password_reset_link_sent',
    targetType: 'user',
    targetId: userId,
    meta: {
      sso: outcome?.sso ?? false,
      status: outcome?.result.status ?? 'not_configured',
    },
  })
  return outcome
}

/** Verification mail for an unverified account. Already verified → nothing sent. */
export async function sendVerificationEmail(
  userId: string,
): Promise<SendResult | null> {
  const row = (
    await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  if (!row || row.emailVerified) return null
  const queued = await queueAccountEmail({
    kind: 'verify_email',
    userId,
    params: { userId },
    immediate: true,
  })
  if (!queued) return null
  return sendNow(queued.id, { claimedAttempt: queued.claimedAttempt })
}

/** Removes a reset token, so a link that was never sent cannot be used. */
async function removeResetToken(userId: string, token: string) {
  await db
    .delete(verification)
    .where(
      and(
        inArray(
          verification.identifier,
          verificationIdentifierForms(`reset-password:${token}`),
        ),
        eq(verification.value, userId),
      ),
    )
}

/** Sends the reset link, or the SSO pointer, and reports which one it was. */
async function deliverReset(
  userId: string,
  token: string,
): Promise<{ sso: boolean; result: SendResult } | null> {
  const person = (
    await db
      .select({ blockedAt: user.blockedAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  // A blocked person gets no mail, and the answer is the same as for an
  // unknown address. Their sign-in is refused anyway (see auth.ts).
  if (person?.blockedAt) {
    await removeResetToken(userId, token)
    return null
  }

  const accounts = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId))
  const hasPassword = accounts.some((row) => row.providerId === 'credential')

  if (!hasPassword) {
    await removeResetToken(userId, token)
    const providers = [
      ...new Set(accounts.map((row) => providerName(row.providerId))),
    ]
    const queued = await queueAccountEmail({
      kind: 'password_reset_sso',
      userId,
      params: { userId, providers },
      immediate: true,
    })
    if (!queued) return null
    return {
      sso: true,
      result: await sendNow(queued.id, {
        claimedAttempt: queued.claimedAttempt,
      }),
    }
  }

  // The token is stored encrypted when a key exists, so a retry can rebuild
  // the link. Without a key, only this immediate send can carry it.
  const key = secretsEncryptionKey()
  const params: Record<string, unknown> = { userId }
  if (key)
    params.encryptedToken = encryptSecret(token, key, PARAMS_SECRET_CONTEXT)
  const renderParams = { token }
  const queued = await queueAccountEmail({
    kind: 'password_reset',
    userId,
    params,
    renderParams,
    immediate: true,
  })
  if (!queued) return null
  return {
    sso: false,
    result: await sendNow(queued.id, {
      renderParams,
      claimedAttempt: queued.claimedAttempt,
    }),
  }
}

function providerName(providerId: string) {
  return PROVIDER_NAMES[providerId] ?? providerId
}

function newResetToken() {
  return Array.from(
    { length: RESET_TOKEN_LENGTH },
    () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)],
  ).join('')
}
