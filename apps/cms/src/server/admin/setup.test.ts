import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { user } from '#/db/schema'

import { completeSetup, getSetupStatus } from './setup.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('setup', () => {
  it('refuses completeSetup when the user table is not empty', async () => {
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
      expect(await getSetupStatus()).toEqual({ needsSetup: false })
      await expect(
        completeSetup({
          name: 'Late Admin',
          email: `late-admin-${suffix}@test.local`,
          password: 'password123',
        }),
      ).rejects.toThrow('Setup already completed')
    } finally {
      await db.delete(user).where(eq(user.id, existing.id))
    }
  })
})
