/** Granting and revoking the agency admin role. */
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { NotFoundError } from '#/server/content/errors'
import { sendAccountEmail } from '#/server/mail/account-emails'
import { revokeAgencyMcpCredentials } from '#/server/mcp/keys'

import {
  assertAgencyAdminCanBeRemoved,
  countActiveAgencyAdmins,
  lockAgencyAdminRoster,
} from './agency-admin-roster.ts'

export async function setAgencyAdmin(
  userId: string,
  isAgencyAdmin: boolean,
  actorId: string,
) {
  return db.transaction(async (tx) => {
    await lockAgencyAdminRoster(tx)
    const existing = (
      await tx
        .select({
          id: user.id,
          isAgencyAdmin: user.isAgencyAdmin,
          blockedAt: user.blockedAt,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
    ).at(0)
    if (!existing) {
      throw new NotFoundError(m.server_user_not_found())
    }

    // A blocked admin is not active, so demoting them takes nothing away.
    if (existing.isAgencyAdmin && !isAgencyAdmin && !existing.blockedAt) {
      assertAgencyAdminCanBeRemoved(await countActiveAgencyAdmins(tx))
    }

    const updated = (
      await tx
        .update(user)
        .set({ isAgencyAdmin, updatedAt: new Date() })
        .where(eq(user.id, userId))
        .returning({
          id: user.id,
          name: user.name,
          email: user.email,
          isAgencyAdmin: user.isAgencyAdmin,
        })
    ).at(0)
    if (!updated) {
      throw new NotFoundError(m.server_user_not_found())
    }

    if (existing.isAgencyAdmin !== isAgencyAdmin) {
      // Agency keys and agency app connections end with the role (agency-mcp Decision 12).
      if (!isAgencyAdmin) {
        await revokeAgencyMcpCredentials(tx, { userId })
      }
      await audit(
        {
          organizationId: null,
          actorId,
          action: isAgencyAdmin ? 'agency_admin.grant' : 'agency_admin.revoke',
          targetType: 'user',
          targetId: userId,
        },
        tx,
      )
      // A security notice, so it is sent whatever the person's preferences.
      const actor = (
        await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, actorId))
          .limit(1)
      ).at(0)
      const at = new Date().toISOString()
      await sendAccountEmail({
        kind: isAgencyAdmin ? 'agency_admin_granted' : 'agency_admin_revoked',
        userId,
        params: { userId, at, actorName: actor?.name ?? '' },
        connection: tx,
      })
    }

    return updated
  })
}
