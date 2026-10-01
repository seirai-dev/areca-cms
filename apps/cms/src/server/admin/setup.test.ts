import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Pin SETUP_TOKEN per test without touching the real environment.
const tokens = vi.hoisted(() => ({
  configured: undefined as string | undefined,
}))
vi.mock('#/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/env')>()
  return {
    env: new Proxy(actual.env, {
      get: (target, key, receiver) =>
        key === 'SETUP_TOKEN'
          ? tokens.configured
          : Reflect.get(target, key, receiver),
    }),
  }
})

import { db } from '#/db'
import { auditLog, user } from '#/db/schema'

import { completeSetup, getSetupStatus } from './setup.ts'
import { resetGeneratedSetupToken } from './setup-token.ts'

const hasDb = Boolean(process.env.DATABASE_URL)
const TOKEN = 'test-setup-token-0123456789'

afterEach(() => {
  tokens.configured = undefined
  resetGeneratedSetupToken()
  vi.restoreAllMocks()
})

async function hasUsers() {
  const [row] = await db.select({ id: user.id }).from(user).limit(1)
  return Boolean(row)
}

describe.skipIf(!hasDb)('setup', () => {
  async function withExistingUser(body: (suffix: string) => Promise<void>) {
    const suffix = crypto.randomUUID()
    const [existing] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Existing ${suffix}`,
        email: `existing-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!existing) throw new Error('Failed to create existing user')
    try {
      await body(suffix)
    } finally {
      await db.delete(user).where(eq(user.id, existing.id))
    }
  }

  const input = (suffix: string, setupToken?: string) => ({
    name: 'Late Admin',
    email: `late-admin-${suffix}@test.local`,
    password: 'password123',
    setupToken,
  })

  it('refuses completeSetup when the user table is not empty', async () => {
    tokens.configured = TOKEN
    await withExistingUser(async (suffix) => {
      expect(await getSetupStatus()).toEqual({ needsSetup: false })
      await expect(completeSetup(input(suffix, TOKEN))).rejects.toThrow(
        'Setup already completed',
      )
    })
  })

  it('rejects a wrong setup token with a generic error', async () => {
    tokens.configured = TOKEN
    await withExistingUser(async (suffix) => {
      await expect(
        completeSetup(input(suffix, 'wrong-token-0123456789')),
      ).rejects.toThrow('setup token is missing or incorrect')
    })
  })

  it('rejects a missing setup token with the same error', async () => {
    tokens.configured = TOKEN
    await withExistingUser(async (suffix) => {
      await expect(completeSetup(input(suffix))).rejects.toThrow(
        'setup token is missing or incorrect',
      )
      await expect(completeSetup(input(suffix, ''))).rejects.toThrow(
        'setup token is missing or incorrect',
      )
    })
  })

  it('does not reveal that setup is done: a set-up instance with no token configured rejects any token', async () => {
    await withExistingUser(async (suffix) => {
      await expect(completeSetup(input(suffix, TOKEN))).rejects.toThrow(
        'setup token is missing or incorrect',
      )
    })
  })

  it('creates the first admin when the token is correct', async (ctx) => {
    // The success path needs an empty user table, which parallel suites that
    // create users can occupy; run this file on its own to exercise it.
    if (await hasUsers()) ctx.skip()
    tokens.configured = TOKEN
    const suffix = crypto.randomUUID()
    const email = `first-admin-${suffix}@test.local`
    try {
      const created = await completeSetup({ ...input(suffix, TOKEN), email })
      expect(created).toMatchObject({ email, isAgencyAdmin: true })
      expect(await getSetupStatus()).toEqual({ needsSetup: false })
      const rows = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, created.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        action: 'setup.completed',
        organizationId: null,
        actorId: created.id,
      })
    } finally {
      await db.delete(auditLog).where(eq(auditLog.action, 'setup.completed'))
      await db.delete(user).where(eq(user.email, email))
    }
  })

  it('accepts the generated token when SETUP_TOKEN is unset', async (ctx) => {
    if (await hasUsers()) ctx.skip()
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const status = await getSetupStatus()
    expect(status).toEqual({ needsSetup: true })
    expect(log).toHaveBeenCalledTimes(1)
    const logged = String(log.mock.calls[0]?.[0])
    const generated = /token: (\S+)/.exec(logged)?.[1]
    expect(generated).toBeTruthy()

    const suffix = crypto.randomUUID()
    await expect(completeSetup(input(suffix, 'not-the-token'))).rejects.toThrow(
      'setup token is missing or incorrect',
    )
    const email = `generated-${suffix}@test.local`
    try {
      await completeSetup({ ...input(suffix, generated), email })
      expect(await getSetupStatus()).toEqual({ needsSetup: false })
    } finally {
      await db.delete(user).where(eq(user.email, email))
    }
  })
})
