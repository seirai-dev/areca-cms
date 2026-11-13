import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { account, emailOutbox, session, user, verification } from '#/db/schema'
import { auth } from '#/lib/auth'
import { recordLocalMfaForToken } from '#/server/security/local-mfa'

import { waitForMail } from './mailpit.test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const created: string[] = []

function cookieHeader(headers: Headers) {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  })
}

/** Rows are written directly, as the setup and invitation paths do. */
async function makeUser(options: { password?: string; providers?: string[] }) {
  const context = await auth.$context
  const id = crypto.randomUUID()
  const email = `flow-${id}@areca.local`
  await db.insert(user).values({
    id,
    name: 'Flow Person',
    email,
    emailVerified: true,
    locale: 'en',
  })
  if (options.password) {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      providerId: 'credential',
      accountId: id,
      password: await context.password.hash(options.password),
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

async function signIn(email: string, password: string) {
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  })
  return cookieHeader(signedIn.headers)
}

async function countOutbox(userId: string, kind: string) {
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.userId, userId), eq(emailOutbox.kind, kind)))
  return rows.length
}

afterAll(async () => {
  if (created.length === 0) return
  await db.delete(emailOutbox).where(inArray(emailOutbox.userId, created))
  await db.delete(verification).where(inArray(verification.value, created))
  await db.delete(user).where(inArray(user.id, created))
})

/** Better Auth's endpoints against the real database and SMTP (Mailpit). */
describe.skipIf(!hasDb)('account auth flows', () => {
  it('password reset: mail, new password, sessions revoked, one-time link', async () => {
    const person = await makeUser({ password: 'old-password-123' })
    const headers = await signIn(person.email, 'old-password-123')

    await auth.api.requestPasswordReset({ body: { email: person.email } })
    const mail = await waitForMail(person.email)
    const token = mail?.html.match(/reset-password\?token=([A-Za-z0-9]+)/)?.[1]
    expect(token).toBeTruthy()

    await expect(
      auth.api.resetPassword({
        body: { newPassword: 'new-password-456', token: token ?? '' },
      }),
    ).resolves.toEqual({ status: true })

    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, person.id))
    expect(sessions).toHaveLength(0)
    expect(await auth.api.getSession({ headers })).toBeNull()
    expect(await countOutbox(person.id, 'password_changed')).toBe(1)

    // The link works once.
    await expect(
      auth.api.resetPassword({
        body: { newPassword: 'another-password-789', token: token ?? '' },
      }),
    ).rejects.toThrow()
  })

  it('SSO-only accounts get the provider pointer, not a reset link', async () => {
    const person = await makeUser({ providers: ['microsoft'] })

    await auth.api.requestPasswordReset({ body: { email: person.email } })
    const mail = await waitForMail(person.email)
    expect(mail?.subject).toContain('Microsoft')
    expect(mail?.html).not.toContain('reset-password?token=')

    const left = await db
      .select()
      .from(verification)
      .where(eq(verification.value, person.id))
    expect(left).toHaveLength(0)
  })

  it('limits reset requests to three per address per hour', async () => {
    const person = await makeUser({ password: 'limited-password-1' })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await auth.api.requestPasswordReset({ body: { email: person.email } })
    }

    const error = await auth.api
      .requestPasswordReset({ body: { email: person.email } })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      body: { code: 'PASSWORD_RESET_RATE_LIMITED' },
    })
  })

  it('tells the account once when two-factor is actually turned off', async () => {
    const person = await makeUser({ password: 'mfa-password-12345' })
    let headers = await signIn(person.email, 'mfa-password-12345')
    await db
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.id, person.id))
    // As if the code had been entered in this session (turning two-factor on
    // through verify-totp records this).
    for (const row of await db
      .select({ token: session.token })
      .from(session)
      .where(eq(session.userId, person.id)))
      await recordLocalMfaForToken(row.token)

    const first = await auth.api.disableTwoFactor({
      body: { password: 'mfa-password-12345' },
      headers,
      returnHeaders: true,
    })
    expect(await countOutbox(person.id, 'two_factor_disabled')).toBe(1)

    // Already off: the endpoint writes the same value, so nothing is sent.
    headers = cookieHeader(first.headers)
    await auth.api.disableTwoFactor({
      body: { password: 'mfa-password-12345' },
      headers,
    })
    expect(await countOutbox(person.id, 'two_factor_disabled')).toBe(1)
  })

  it('sends the password changed notice for a successful change only', async () => {
    const person = await makeUser({ password: 'change-password-1234' })
    const headers = await signIn(person.email, 'change-password-1234')

    await expect(
      auth.api.changePassword({
        body: {
          currentPassword: 'wrong-current-password',
          newPassword: 'change-password-5678',
        },
        headers,
      }),
    ).rejects.toThrow()
    expect(await countOutbox(person.id, 'password_changed')).toBe(0)

    await auth.api.changePassword({
      body: {
        currentPassword: 'change-password-1234',
        newPassword: 'change-password-5678',
      },
      headers,
    })
    expect(await countOutbox(person.id, 'password_changed')).toBe(1)
  })
})
