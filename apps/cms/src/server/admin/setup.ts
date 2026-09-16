import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth } from '#/lib/auth'
import { m } from '#/paraglide/messages'
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
      throw new ConflictError(m.server_setup_already_completed())
    }

    // The first admin is always created with a password, even when password
    // sign-in is switched off in the environment, so the instance can never be
    // bootstrapped into a state with no way in. Writing the credential through
    // Better Auth's internals (instead of the sign-up endpoint) keeps that
    // true when `emailAndPassword` is disabled.
    const authContext = await auth.$context
    const created = await authContext.internalAdapter.createUser(
      {
        name: input.name,
        email: input.email,
        emailVerified: false,
      },
      { method: 'email-password' },
    )
    if (!created) {
      throw new Error(m.server_failed_to_create_user())
    }
    await authContext.internalAdapter.createAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: await authContext.password.hash(input.password),
    })

    const [updated] = await tx
      .update(user)
      .set({ isAgencyAdmin: true, updatedAt: new Date() })
      .where(eq(user.id, created.id))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        isAgencyAdmin: user.isAgencyAdmin,
      })
    if (!updated) {
      throw new Error(m.server_failed_to_promote_admin())
    }

    // audit_log.organizationId is required, so skip the setup.completed row.
    return updated
  })
}
