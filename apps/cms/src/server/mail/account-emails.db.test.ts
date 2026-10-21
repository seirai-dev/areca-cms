/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import type * as MailConfig from '#/server/mail/config'

import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { account, auditLog, emailOutbox, user, verification } from '#/db/schema'
import { decryptSecret } from '#/server/security/secret-encryption'
import { secretsEncryptionKey } from '#/server/security/secrets-key'

import {
  deliverPasswordReset,
  sendAccountEmail,
  sendPasswordResetLink,
  sendVerificationEmail,
} from './account-emails.ts'
import { waitForMail } from './mailpit.test-utils.ts'

// `override` null: mail is not configured. Undefined: the environment (Mailpit).
const override = vi.hoisted(() => ({ value: undefined as null | undefined }))

vi.mock('#/server/mail/config', async (importOriginal) => {
  const actual = await importOriginal<typeof MailConfig>()
  return {
    ...actual,
    resolveMailConfig: async () => {
      if (override.value === null) return null
      return actual.resolveMailConfig()
    },
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)

beforeEach(() => {
  override.value = undefined
})

type Fixture = { id: string; email: string }
const created: string[] = []

/** A user with a password (`credential`) or only a provider link (SSO). */
async function makeUser(
  options: {
    password?: boolean
    providers?: string[]
    verified?: boolean
  } = {},
): Promise<Fixture> {
  const id = crypto.randomUUID()
  const email = `acct-${id}@areca.local`
  await db.insert(user).values({
    id,
    name: 'Account Person',
    email,
    emailVerified: options.verified ?? false,
    locale: 'nl',
  })
  if (options.password !== false) {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      providerId: 'credential',
      accountId: id,
      password: 'hash-not-checked-here',
    })
  }
  for (const providerId of options.providers ?? []) {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      providerId,
      accountId: `${providerId}-${id}`,
    })
  }
  created.push(id)
  return { id, email }
}

async function outboxFor(userId: string, kind: string) {
  return db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.userId, userId), eq(emailOutbox.kind, kind)))
}

afterAll(async () => {
  if (created.length === 0) return
  await db.delete(emailOutbox).where(inArray(emailOutbox.userId, created))
  await db.delete(auditLog).where(inArray(auditLog.targetId, created))
  await db.delete(verification).where(inArray(verification.value, created))
  await db.delete(user).where(inArray(user.id, created))
})

describe.skipIf(!hasDb)('account emails', () => {
  it('sends the provider pointer and removes the reset token for SSO-only accounts', async () => {
    const person = await makeUser({
      password: false,
      providers: ['microsoft'],
    })
    const token = `sso-${crypto.randomUUID()}`
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `reset-password:${token}`,
      value: person.id,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await deliverPasswordReset({ user: person, token })
    expect(result).toMatchObject({ status: 'sent' })

    const [left] = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `reset-password:${token}`))
    expect(left).toBeUndefined()

    const [row] = await outboxFor(person.id, 'password_reset_sso')
    expect(row).toMatchObject({
      status: 'sent',
      template: 'password_reset_sso',
    })
    expect(row?.params).toEqual({ userId: person.id, providers: ['Microsoft'] })

    const mail = await waitForMail(person.email)
    expect(mail?.subject).toContain('Microsoft')
    expect(mail?.html).not.toContain('reset-password?token=')
  })

  it('keeps the reset token out of the outbox row', async () => {
    const person = await makeUser()
    const token = `tok-${crypto.randomUUID().replaceAll('-', '')}`

    const result = await deliverPasswordReset({ user: person, token })
    expect(result).toMatchObject({ status: 'sent' })

    const [row] = await outboxFor(person.id, 'password_reset')
    expect(row).toBeDefined()
    expect(JSON.stringify(row)).not.toContain(token)
    expect(row?.params.token).toBeUndefined()
    expect(row?.subject).toBe('Stel je wachtwoord opnieuw in')

    const key = secretsEncryptionKey()
    if (!key) throw new Error('test key missing')
    const stored = row?.params.encryptedToken
    expect(typeof stored).toBe('string')
    expect(decryptSecret(stored as string, key, 'email-outbox:params')).toBe(
      token,
    )

    const mail = await waitForMail(person.email)
    expect(mail?.html).toContain(`/reset-password?token=${token}`)
  })

  it('returns null and queues nothing when mail is not configured', async () => {
    const person = await makeUser({ verified: false })
    override.value = null

    await expect(
      sendAccountEmail({
        kind: 'verify_email',
        userId: person.id,
        params: { userId: person.id },
      }),
    ).resolves.toBeNull()
    expect(await outboxFor(person.id, 'verify_email')).toHaveLength(0)
  })

  it('queues a render-only token without writing it to the row', async () => {
    const person = await makeUser()
    const token = `queued-${crypto.randomUUID()}`

    const queued = await sendAccountEmail({
      kind: 'password_reset',
      userId: person.id,
      params: { userId: person.id },
      renderParams: { token },
    })
    expect(queued).toEqual({ status: 'queued', id: expect.any(String) })
    const [row] = await outboxFor(person.id, 'password_reset')
    expect(JSON.stringify(row)).not.toContain(token)
    expect(row?.subject).toBe('Stel je wachtwoord opnieuw in')
  })

  it('sends verification mail to unverified accounts only', async () => {
    const unverified = await makeUser({ verified: false })
    const verified = await makeUser({ verified: true })

    const sent = await sendVerificationEmail(unverified.id)
    expect(sent).toMatchObject({ status: 'sent' })
    const mail = await waitForMail(unverified.email)
    expect(mail?.html).toContain('/api/auth/verify-email?token=')

    expect(await sendVerificationEmail(verified.id)).toBeNull()
    expect(await outboxFor(verified.id, 'verify_email')).toHaveLength(0)
  })

  it('admin reset link: creates a one-hour token, audits, and reports SSO accounts', async () => {
    const actor = await makeUser({ verified: true })
    const person = await makeUser({ verified: true })
    const ssoOnly = await makeUser({
      password: false,
      providers: ['google'],
      verified: true,
    })

    const reset = await sendPasswordResetLink(person.id, actor.id)
    expect(reset).toMatchObject({ sso: false, result: { status: 'sent' } })
    const [tokenRow] = await db
      .select()
      .from(verification)
      .where(
        and(
          like(verification.identifier, 'reset-password:%'),
          eq(verification.value, person.id),
        ),
      )
    expect(tokenRow).toBeDefined()
    expect(tokenRow.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      50 * 60_000,
    )
    expect(tokenRow.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      60 * 60_000,
    )

    const ssoReset = await sendPasswordResetLink(ssoOnly.id, actor.id)
    expect(ssoReset).toMatchObject({ sso: true, result: { status: 'sent' } })

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'user.password_reset_link_sent'),
          eq(auditLog.targetId, person.id),
        ),
      )
    expect(audit).toMatchObject({
      organizationId: null,
      actorId: actor.id,
      targetType: 'user',
    })
    expect(audit?.meta).toMatchObject({ sso: false, status: 'sent' })
  })
})
