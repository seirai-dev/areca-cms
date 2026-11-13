import { eq } from 'drizzle-orm'

import { m } from '#/paraglide/messages'
import { db } from '#/db'
import { user } from '#/db/schema'
import { audit } from '#/server/audit'
import { ForbiddenError, NotFoundError } from '#/server/content/errors'
import { withFactorLock } from './factor-lock'
import { clearFactorLockout } from './step-up'

/** Recovery changes only the failure budget, never the factor or its proof. */
export async function resetAdminFactorLockout(userId: string, actorId: string) {
  if (userId === actorId)
    throw new ForbiddenError(m.server_factor_lockout_self_reset())
  await withFactorLock(userId, () =>
    db.transaction(async (tx) => {
      const target = (
        await tx.select().from(user).where(eq(user.id, userId)).limit(1)
      ).at(0)
      if (!target?.isAgencyAdmin)
        throw new NotFoundError(m.server_user_not_found())
      await clearFactorLockout(tx, userId)
      await audit(
        {
          organizationId: null,
          actorId,
          action: 'security.factor_lockout_reset',
          targetType: 'user',
          targetId: userId,
        },
        tx,
      )
    }),
  )
}
