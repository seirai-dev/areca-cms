/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { createHmac } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { securityErrorCode } from '#/lib/security-errors'

import { db } from '#/db'
import { env } from '#/env'
import { account, session, twoFactor, user } from '#/db/schema'
import {
  localMfaVerifiedAt,
  recordLocalMfaForToken,
  requireMemberLocalMfa,
} from './local-mfa'
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
    const verified = await auth.api.verifyTOTP({
      body: { code },
      headers,
      returnHeaders: true,
    })
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

    const challenged = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })
    expect(challenged.response).toMatchObject({ twoFactorRedirect: true })

    // Passing the sign-in challenge counts as this session's code, so the
    // CMS does not ask a second time.
    const passed = await auth.api.verifyTOTP({
      body: { code: totp(secret) },
      headers: cookieHeader(challenged.headers),
    })
    const [signedInSession] = await db
      .select()
      .from(session)
      .where(eq(session.token, passed.token))
    if (!signedInSession) throw new Error('expected the signed-in session')
    const principal = {
      session: signedInSession,
      user: { id: userId, twoFactorEnabled: true, isAgencyAdmin: false },
    }
    expect(await localMfaVerifiedAt(principal)).toBeInstanceOf(Date)
    await expect(requireMemberLocalMfa(principal)).resolves.toBeUndefined()

    // The secret was shown during enrolment. Once enabled, it is not handed out again.
    await expect(
      auth.api.getTOTPURI({
        body: { password },
        headers: cookieHeader(verified.headers),
      }),
    ).rejects.toMatchObject({ body: { code: 'TOTP_URI_UNAVAILABLE' } })
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

/** A session row as a social or SSO sign-in leaves it: no code entered. */
async function providerSession(userId: string) {
  const token = crypto.randomUUID()
  const [row] = await db
    .insert(session)
    .values({
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })
    .returning()
  if (!row) throw new Error('session insert failed')
  return row
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe.skipIf(!hasDb)('a provider sign-in of a two-factor user', () => {
  const ids: string[] = []

  afterAll(async () => {
    for (const id of ids) await db.delete(user).where(eq(user.id, id))
  })

  async function makeUser(values: {
    twoFactorEnabled: boolean
    isAgencyAdmin?: boolean
  }) {
    const id = crypto.randomUUID()
    ids.push(id)
    await db.insert(user).values({
      id,
      name: 'Provider User',
      email: `provider-${id}@test.local`,
      emailVerified: true,
      ...values,
    })
    return id
  }

  it('is refused until a code is entered in that session', async () => {
    const userId = await makeUser({ twoFactorEnabled: true })
    const row = await providerSession(userId)
    const principal = {
      session: row,
      user: { id: userId, twoFactorEnabled: true, isAgencyAdmin: false },
    }

    const refused = await rejection(requireMemberLocalMfa(principal))
    expect(securityErrorCode(refused)).toBe('MFA_REQUIRED')

    // Nor can it change two-factor before the code, password or not.
    const headers = new Headers({
      cookie: `better-auth.session_token=${encodeURIComponent(
        `${row.token}.${createHmac('sha256', env.BETTER_AUTH_SECRET).update(row.token).digest('base64')}`,
      )}`,
    })
    await expect(
      auth.api.disableTwoFactor({ body: {}, headers }),
    ).rejects.toMatchObject({ body: { code: 'MFA_REQUIRED' } })

    await recordLocalMfaForToken(row.token)
    await expect(requireMemberLocalMfa(principal)).resolves.toBeUndefined()
  })

  it('leaves users without two-factor and agency admins to their own rules', async () => {
    const plainId = await makeUser({ twoFactorEnabled: false })
    const plain = await providerSession(plainId)
    await expect(
      requireMemberLocalMfa({
        session: plain,
        user: { id: plainId, twoFactorEnabled: false, isAgencyAdmin: false },
      }),
    ).resolves.toBeUndefined()

    const adminId = await makeUser({
      twoFactorEnabled: true,
      isAgencyAdmin: true,
    })
    const admin = await providerSession(adminId)
    await expect(
      requireMemberLocalMfa({
        session: admin,
        user: { id: adminId, twoFactorEnabled: true, isAgencyAdmin: true },
      }),
    ).resolves.toBeUndefined()
  })
})
