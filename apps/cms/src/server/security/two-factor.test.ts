/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { createHmac } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { account, session, twoFactor, user } from '#/db/schema'
import { localMfaVerifiedAt } from './local-mfa'
import { auth } from '#/lib/auth'

const hasDb = Boolean(process.env.DATABASE_URL)

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s) from an otpauth base32 secret. */
function totp(base32: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of base32.replace(/=+$/, '')) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const hmac = createHmac('sha1', key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 1_000_000).padStart(6, '0')
}

/**
 * Rows are written directly: the registration gate (invite-only once any
 * account exists) would otherwise make these tests depend on table state.
 */
async function insertUser(
  context: Awaited<typeof auth.$context>,
  name: string,
  email: string,
  password: string,
) {
  const id = crypto.randomUUID()
  await db.insert(user).values({ id, name, email, emailVerified: true })
  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId: id,
    providerId: 'credential',
    accountId: id,
    password: await context.password.hash(password),
  })
  return id
}

function cookieHeader(headers: Headers) {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  })
}

/** Better Auth's two-factor plugin against the real schema, end to end. */
describe.skipIf(!hasDb)('two-factor (Better Auth)', () => {
  const suffix = crypto.randomUUID()
  const email = `mfa-${suffix}@test.local`
  const password = 'password123'
  let userId = ''

  afterAll(async () => {
    if (userId) await db.delete(user).where(eq(user.id, userId))
  })

  it('enrols a user with TOTP, then challenges the next sign-in', async () => {
    const context = await auth.$context
    userId = await insertUser(context, 'Mfa User', email, password)

    const signedIn = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })
    const headers = cookieHeader(signedIn.headers)

    const enabled = await auth.api.enableTwoFactor({
      body: { password },
      headers,
    })
    if (!('totpURI' in enabled)) throw new Error('expected a TOTP enrolment')
    expect(enabled.backupCodes.length).toBeGreaterThan(0)

    // Not enabled until the first code is confirmed.
    const [pending] = await db.select().from(user).where(eq(user.id, userId))
    expect(pending?.twoFactorEnabled).toBe(false)

    const secret = new URL(enabled.totpURI).searchParams.get('secret') ?? ''
    const code = totp(secret)
    await auth.api.verifyTOTP({ body: { code }, headers })
    const [factorSession] = await db
      .select()
      .from(session)
      .where(eq(session.userId, userId))
    expect(
      await localMfaVerifiedAt({
        session: factorSession,
        user: { id: userId },
      }),
    ).toBeInstanceOf(Date)

    const [enrolled] = await db.select().from(user).where(eq(user.id, userId))
    expect(enrolled?.twoFactorEnabled).toBe(true)
    const rows = await db
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.verified).toBe(true)

    const challenged = await auth.api.signInEmail({ body: { email, password } })
    expect(challenged).toMatchObject({ twoFactorRedirect: true })
  })
})

describe.skipIf(!hasDb)('two-factor without a password', () => {
  const suffix = crypto.randomUUID()
  const email = `sso-${suffix}@test.local`
  let userId = ''

  afterAll(async () => {
    if (userId) await db.delete(user).where(eq(user.id, userId))
  })

  it('lets a passwordless user enrol only with a fresh session', async () => {
    const context = await auth.$context
    userId = await insertUser(context, 'Sso User', email, 'password123')
    const signedIn = await auth.api.signInEmail({
      body: { email, password: 'password123' },
      returnHeaders: true,
    })
    const headers = cookieHeader(signedIn.headers)
    // Make the account passwordless, like a provider-only sign-in.
    await db
      .update(account)
      .set({ password: null })
      .where(eq(account.userId, userId))

    // Stale session: refused with REAUTH_REQUIRED.
    await db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(session.userId, userId))
    await expect(
      auth.api.enableTwoFactor({ body: {}, headers }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('REAUTH_REQUIRED'),
    })

    // Fresh session: no password needed.
    await db
      .update(session)
      .set({ createdAt: new Date() })
      .where(eq(session.userId, userId))
    const enabled = await auth.api.enableTwoFactor({ body: {}, headers })
    expect(enabled).toHaveProperty('totpURI')
  })
})
