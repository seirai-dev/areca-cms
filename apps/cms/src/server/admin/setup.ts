import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth } from '#/lib/auth'
import { ConflictError } from '#/server/content/errors'

const SETUP_LOCK_KEY = 87236401

export async function getSetupStatus() {
  const [row] = await db.select({ id: user.id }).from(user).limit(1)
  return { needsSetup: !row }
}

export async function completeSetup(input: {
  name: string
  email: string
  password: string
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`)

    const [existing] = await tx.select({ id: user.id }).from(user).limit(1)
    if (existing) {
      throw new ConflictError('Setup already completed')
    }

    const result = await auth.api.signUpEmail({
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
      },
    })
    if (!result.user) {
      throw new Error('Failed to create user')
    }

    const [updated] = await tx
      .update(user)
      .set({ isAgencyAdmin: true, updatedAt: new Date() })
      .where(eq(user.id, result.user.id))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        isAgencyAdmin: user.isAgencyAdmin,
      })
    if (!updated) {
      throw new Error('Failed to promote the first user to agency admin')
    }

    // audit_log.organizationId is required, so skip the setup.completed row.
    return updated
  })
}
