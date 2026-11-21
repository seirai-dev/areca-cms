import { and, desc, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  account,
  auditLog,
  emailOutbox,
  session,
  user,
  verification,
} from '#/db/schema'
import { auth } from '#/lib/auth'
import { recordLocalMfaForToken } from '#/server/security/local-mfa'
import { recordStepUp } from '#/server/security/step-up'

import { emailChangeLink, pendingEmailChange } from './email-change.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const created: string[] = []
const PASSWORD = 'change-email-pass-1'

function cookieHeader(headers: Headers) {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  })
}

/** An account with a password; `twoFactor` is switched on after sign-in. */
async function makePerson(options: { admin: boolean }) {
  const context = await auth.$context
  const id = crypto.randomUUID()
  const email = `move-${id}@areca.local`
  await db.insert(user).values({
    id,
    name: 'Mover',
    email,
    emailVerified: true,
    isAgencyAdmin: options.admin,
    locale: 'en',
  })
  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId: id,
    providerId: 'credential',
    accountId: id,
    password: await context.password.hash(PASSWORD),
  })
  created.push(id)
  return { id, email }
}

async function signIn(email: string) {
  const signedIn = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  })
  return cookieHeader(signedIn.headers)
}

/**
 * Signs in, then turns two-factor on and records the code from that sign-in,
 * as the challenge would. Returns the headers and the session id.
 */
async function signInWithTwoFactor(person: { id: string; email: string }) {
  const headers = await signIn(person.email)
  await db
    .update(user)
    .set({ twoFactorEnabled: true })
    .where(eq(user.id, person.id))
  const [row] = await db
    .select({ id: session.id, token: session.token })
    .from(session)
    .where(eq(session.userId, person.id))
    .orderBy(desc(session.createdAt))
    .limit(1)
  await recordLocalMfaForToken(row.token)
  return { headers, sessionId: row.id }
}

function requestChange(
  headers: Headers,
  newEmail: string,
  password = PASSWORD,
) {
  // `currentPassword` is read by the before hook, not by Better Auth's schema.
  const body = { newEmail, currentPassword: password } as { newEmail: string }
  return auth.api.changeEmail({ headers, body })
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { body?: { code?: string } }
  }
  throw new Error('expected the request to fail')
}

async function outbox(userId: string, kind: string) {
  return db
    .select({ to: emailOutbox.toAddress })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.userId, userId), eq(emailOutbox.kind, kind)))
}

/** The confirmation is sent in the background, after the response. */
async function waitForPending(userId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = await pendingEmailChange(userId)
    if (pending && (await outbox(userId, 'email_change_verify')).length) {
      return pending
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

async function openLink(userId: string, newEmail: string, headers?: Headers) {
  const link = await emailChangeLink(userId, newEmail)
  if (!link) throw new Error('no pending change')
  const response = await auth.handler(new Request(link.url, { headers }))
  return { status: response.status, location: response.headers.get('location') }
}

async function auditActions(userId: string) {
  const rows = await db
    .select({ action: auditLog.action, meta: auditLog.meta })
    .from(auditLog)
    .where(eq(auditLog.actorId, userId))
  return rows
}

afterAll(async () => {
  if (created.length === 0) return
  await db.delete(emailOutbox).where(inArray(emailOutbox.userId, created))
  await db.delete(verification).where(inArray(verification.value, created))
  await db.delete(user).where(inArray(user.id, created))
})

describe.skipIf(!hasDb)('changing your own email address', () => {
  it('refuses people who are not agency admins', async () => {
    const person = await makePerson({ admin: false })
    const headers = await signIn(person.email)
    const error = await failure(requestChange(headers, `n-${person.id}@x.test`))
    expect(error.body?.code).toBe('EMAIL_CHANGE_NOT_ALLOWED')
  })

  it('refuses an admin who still has to enrol in two-factor', async () => {
    const person = await makePerson({ admin: true })
    const headers = await signIn(person.email)
    const error = await failure(requestChange(headers, `n-${person.id}@x.test`))
    expect(error.body?.code).toBe('MFA_REQUIRED')
  })

  it('refuses the current address, also in other letter case', async () => {
    const person = await makePerson({ admin: true })
    const { headers } = await signInWithTwoFactor(person)
    const error = await failure(
      requestChange(headers, person.email.toUpperCase()),
    )
    expect(error.body?.code).toBe('EMAIL_CHANGE_SAME')
  })

  it('checks the password before asking for a code, and sends nothing', async () => {
    const person = await makePerson({ admin: true })
    const { headers } = await signInWithTwoFactor(person)
    const target = `n-${person.id}@x.test`

    const wrong = await failure(requestChange(headers, target, 'nope-nope'))
    expect(wrong.body?.code).toBe('INVALID_PASSWORD')

    const noCode = await failure(requestChange(headers, target))
    expect(noCode.body?.code).toBe('REAUTH_REQUIRED')
    expect(await outbox(person.id, 'email_change_verify')).toHaveLength(0)
    expect(await pendingEmailChange(person.id)).toBeNull()
  })

  it('counts wrong passwords against an attempt budget', async () => {
    const person = await makePerson({ admin: true })
    const { headers } = await signInWithTwoFactor(person)
    const target = `n-${person.id}@x.test`
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await failure(requestChange(headers, target, `wrong-${attempt}`))
    }
    const error = await failure(requestChange(headers, target))
    expect(error.body?.code).toBe('EMAIL_CHANGE_RATE_LIMITED')
  })

  it('requests, confirms by link, and cleans up after the move', async () => {
    const person = await makePerson({ admin: true })
    const other = await signIn(person.email)
    const { headers, sessionId } = await signInWithTwoFactor(person)
    const target = `Moved-${person.id}@x.test`
    const lower = target.toLowerCase()

    await recordStepUp(sessionId, person.id)
    await expect(requestChange(headers, target)).resolves.toMatchObject({
      status: true,
    })
    expect(await waitForPending(person.id)).toBe(lower)
    expect(await outbox(person.id, 'email_change_verify')).toEqual([
      { to: lower },
    ])
    expect(await outbox(person.id, 'email_change_notice')).toEqual([
      { to: person.email },
    ])
    expect((await auditActions(person.id)).map((row) => row.action)).toContain(
      'user.email_change_request',
    )

    // The code was used up: another request asks for a new one.
    const again = await failure(requestChange(headers, `x-${person.id}@x.test`))
    expect(again.body?.code).toBe('REAUTH_REQUIRED')

    // Nothing changes before the link is opened.
    const before = await db.select().from(user).where(eq(user.id, person.id))
    expect(before[0].email).toBe(person.email)

    const opened = await openLink(person.id, lower, headers)
    expect(opened.status).toBe(302)
    expect(opened.location).toBe('/account?emailChange=done')

    const [after] = await db.select().from(user).where(eq(user.id, person.id))
    expect(after.email).toBe(lower)
    expect(after.emailVerified).toBe(true)
    expect(await pendingEmailChange(person.id)).toBeNull()

    // Only the session that opened the link stays signed in.
    const sessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, person.id))
    expect(sessions).toEqual([{ id: sessionId }])
    expect(await auth.api.getSession({ headers: other })).toBeNull()

    expect(await outbox(person.id, 'email_changed')).toEqual([
      { to: person.email },
    ])
    const changed = (await auditActions(person.id)).find(
      (row) => row.action === 'user.email_change',
    )
    expect(changed?.meta).toMatchObject({
      previousEmail: person.email,
      newEmail: lower,
    })
  })

  it('a password change cancels the pending change', async () => {
    const person = await makePerson({ admin: true })
    const { headers, sessionId } = await signInWithTwoFactor(person)
    const target = `c-${person.id}@x.test`
    await recordStepUp(sessionId, person.id)
    await requestChange(headers, target)
    expect(await waitForPending(person.id)).toBe(target)
    const link = await emailChangeLink(person.id, target)

    await auth.api.changePassword({
      headers,
      body: { currentPassword: PASSWORD, newPassword: 'a-new-password-2' },
    })
    expect(await pendingEmailChange(person.id)).toBeNull()

    const response = await auth.handler(new Request(link?.url ?? ''))
    expect(response.headers.get('location')).toBe(
      '/account?emailChange=done&error=EMAIL_CHANGE_CANCELLED',
    )
    const [row] = await db.select().from(user).where(eq(user.id, person.id))
    expect(row.email).toBe(person.email)
  })

  it('does not move onto an address someone took in the meantime', async () => {
    const person = await makePerson({ admin: true })
    const { headers, sessionId } = await signInWithTwoFactor(person)
    const target = `t-${person.id}@x.test`
    await recordStepUp(sessionId, person.id)
    await requestChange(headers, target)
    expect(await waitForPending(person.id)).toBe(target)

    const squatter = crypto.randomUUID()
    created.push(squatter)
    await db.insert(user).values({
      id: squatter,
      name: 'Squatter',
      email: target.toUpperCase(),
      emailVerified: true,
    })

    const opened = await openLink(person.id, target)
    expect(opened.location).toBe('/account?emailChange=done&error=EMAIL_TAKEN')
    const [row] = await db.select().from(user).where(eq(user.id, person.id))
    expect(row.email).toBe(person.email)
  })

  it('does not apply for someone who is no longer an agency admin', async () => {
    const person = await makePerson({ admin: true })
    const { headers, sessionId } = await signInWithTwoFactor(person)
    const target = `d-${person.id}@x.test`
    await recordStepUp(sessionId, person.id)
    await requestChange(headers, target)
    expect(await waitForPending(person.id)).toBe(target)

    await db
      .update(user)
      .set({ isAgencyAdmin: false })
      .where(eq(user.id, person.id))
    const opened = await openLink(person.id, target)
    expect(opened.location).toBe(
      '/account?emailChange=done&error=EMAIL_CHANGE_NOT_ALLOWED',
    )
  })
})
