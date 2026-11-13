/**
 * Person-level administration: blocking, deleting, renaming, signing people
 * out, resetting two-factor, and the bulk versions of those. Client access
 * lives in `user-access.ts`. Every function here is a domain call: callers
 * (server fns) own the guards and any step-up checks.
 *
 * Blocking suspends a person instead of deleting them: sessions end, queued
 * notices are cancelled, MCP keys and app connections stop working, and
 * memberships are kept so unblocking restores everything.
 */
import { and, eq, ilike, inArray, isNull, or } from 'drizzle-orm'

import { db } from '#/db'
import type { Tx } from '#/db'
import {
  invitation,
  mcpConnection,
  mcpKey,
  membership,
  organization,
  session,
  twoFactor,
  user,
} from '#/db/schema'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { AppError } from '#/server/http/app-error'
import { sendAccountEmail } from '#/server/mail/account-emails'
import { cancelAllQueuedNotificationEmails } from '#/server/mail/outbox'
import { revokeMemberMcpConnections } from '#/server/mcp/connections'
import {
  revokeAgencyMcpCredentials,
  revokeMemberMcpKeys,
} from '#/server/mcp/keys'

import {
  LastAgencyAdminError,
  assertAgencyAdminCanBeRemoved,
  countActiveAgencyAdmins,
  lockAgencyAdminRoster,
} from './agency-admin-roster.ts'
import { countOwners } from './members.ts'
import { lockOrganizationForMutation } from './organization-lock.ts'

/** Longest internal block note an agency admin can write. */
export const BLOCK_REASON_MAX_LENGTH = 500
/** Longest display name a person can have. */
export { PERSON_NAME_MAX_LENGTH } from '#/lib/person-name'

export type PersonRow = {
  id: string
  name: string
  email: string
  isAgencyAdmin: boolean
  blockedAt: Date | null
}

/** Reads and row-locks one person. Missing people answer NotFound. */
const personColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  isAgencyAdmin: user.isAgencyAdmin,
  blockedAt: user.blockedAt,
}

export async function lockPerson(tx: Tx, userId: string): Promise<PersonRow> {
  const row = (
    await tx
      .select(personColumns)
      .from(user)
      .where(eq(user.id, userId))
      .for('update')
  ).at(0)
  if (!row) throw new NotFoundError(m.server_user_not_found())
  return row
}

async function readPerson(tx: Tx, userId: string): Promise<PersonRow> {
  const row = (
    await tx.select(personColumns).from(user).where(eq(user.id, userId))
  ).at(0)
  if (!row) throw new NotFoundError(m.server_user_not_found())
  return row
}

async function nameOf(tx: Tx, userId: string) {
  const row = (
    await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0)
  return row?.name ?? ''
}

function assertNotSelf(actorId: string, userId: string) {
  if (actorId === userId) {
    throw new ConflictError(m.server_cannot_act_on_self())
  }
}

/**
 * The clients a person owns, and whether they are an active agency admin who
 * cannot leave. Read inside the caller's transaction, after its locks.
 */
/**
 * `lock: true` (self delete) locks each owned client before counting its
 * owners. The read-only preview passes `lock: false` and takes no locks, so
 * opening the account page never waits on, or deadlocks with, another request.
 */
async function selfDeleteBlockersIn(
  tx: Tx,
  person: PersonRow,
  { lock }: { lock: boolean },
) {
  const owned = await tx
    .select({
      organizationId: membership.organizationId,
      name: organization.name,
    })
    .from(membership)
    .innerJoin(organization, eq(membership.organizationId, organization.id))
    .where(and(eq(membership.userId, person.id), eq(membership.role, 'owner')))
    .orderBy(membership.organizationId)
  const soleOwnerClients: Array<{ organizationId: string; name: string }> = []
  for (const row of owned) {
    if (lock) await lockOrganizationForMutation(tx, row.organizationId)
    if ((await countOwners(tx, row.organizationId)) <= 1) {
      soleOwnerClients.push({
        organizationId: row.organizationId,
        name: row.name,
      })
    }
  }
  const lastAdmin =
    person.isAgencyAdmin &&
    !person.blockedAt &&
    (await countActiveAgencyAdmins(tx)) <= 1
  return {
    soleOwnerClients,
    soleOwnerOf: soleOwnerClients.map((client) => client.name),
    lastAdmin,
  }
}

/**
 * What stops a person from deleting their own account, without changing
 * anything. The settings page shows these before asking for a password.
 */
export async function selfDeleteBlockers(userId: string) {
  return db.transaction(async (tx) => {
    const person = await readPerson(tx, userId)
    return selfDeleteBlockersIn(tx, person, { lock: false })
  })
}

export async function blockUser(input: {
  actorId: string
  userId: string
  reason?: string | null
}) {
  assertNotSelf(input.actorId, input.userId)
  return db.transaction(async (tx) => {
    await lockAgencyAdminRoster(tx)
    const person = await lockPerson(tx, input.userId)
    if (person.blockedAt) return { changed: false as const }
    if (person.isAgencyAdmin) {
      assertAgencyAdminCanBeRemoved(await countActiveAgencyAdmins(tx))
    }

    const reason = input.reason?.trim() || null
    const now = new Date()
    await tx
      .update(user)
      .set({
        blockedAt: now,
        blockedById: input.actorId,
        blockedReason: reason,
        updatedAt: now,
      })
      .where(eq(user.id, person.id))
    // Signs out everywhere: every session row goes.
    await tx.delete(session).where(eq(session.userId, person.id))
    const notificationsCancelled = await cancelAllQueuedNotificationEmails(
      person.id,
      tx,
    )
    await audit(
      {
        organizationId: null,
        actorId: input.actorId,
        action: 'user.block',
        targetType: 'user',
        targetId: person.id,
        meta: { reason, userName: person.name, notificationsCancelled },
      },
      tx,
    )
    return { changed: true as const }
  })
}

export async function unblockUser(input: { actorId: string; userId: string }) {
  assertNotSelf(input.actorId, input.userId)
  return db.transaction(async (tx) => {
    const person = await lockPerson(tx, input.userId)
    if (!person.blockedAt) return { changed: false as const }
    await tx
      .update(user)
      .set({
        blockedAt: null,
        blockedById: null,
        blockedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, person.id))
    await audit(
      {
        organizationId: null,
        actorId: input.actorId,
        action: 'user.unblock',
        targetType: 'user',
        targetId: person.id,
        meta: { userName: person.name },
      },
      tx,
    )
    return { changed: true as const }
  })
}

/**
 * Removes the account in the caller's transaction: MCP keys and app
 * connections are revoked, queued notices cancelled, the audit row written
 * (with the name and email, since the row outlives the person), and the
 * account email queued. The row delete cascades to sessions, memberships,
 * two-factor and the rest; content keeps its history with null authors.
 */
async function removeAccount(
  tx: Tx,
  input: {
    person: PersonRow
    actorId: string
    actorName: string
    self: boolean
  },
) {
  const { person, actorId, actorName, self } = input
  const keySites = await tx
    .selectDistinct({ siteId: mcpKey.siteId })
    .from(mcpKey)
    .where(eq(mcpKey.userId, person.id))
  const connectionSites = await tx
    .selectDistinct({ siteId: mcpConnection.siteId })
    .from(mcpConnection)
    .where(eq(mcpConnection.userId, person.id))
  // Agency keys and connections have no site; they are revoked with the agency role.
  const siteIds = [
    ...new Set([...keySites, ...connectionSites].map((row) => row.siteId)),
  ].filter((siteId): siteId is string => siteId !== null)
  const mcpKeysRevoked = await revokeMemberMcpKeys(tx, {
    userId: person.id,
    siteIds,
  })
  await revokeAgencyMcpCredentials(tx, { userId: person.id })
  const mcpConnectionsRevoked = await revokeMemberMcpConnections(tx, {
    userId: person.id,
    siteIds,
  })
  const notificationsCancelled = await cancelAllQueuedNotificationEmails(
    person.id,
    tx,
  )

  // Queued in this transaction, so the notice exists exactly when the
  // account goes. The outbox keeps the address and locale, and the renderer
  // does not read the (now deleted) account.
  await sendAccountEmail({
    kind: 'account_deleted',
    userId: person.id,
    params: {
      deletedUserName: person.name,
      actorName,
      self,
      at: new Date().toISOString(),
    },
    connection: tx,
  })

  await audit(
    {
      organizationId: null,
      actorId,
      action: 'user.delete',
      targetType: 'user',
      targetId: person.id,
      meta: {
        deletedUserName: person.name,
        deletedUserEmail: person.email,
        self,
        actorName,
        mcpKeysRevoked,
        mcpConnectionsRevoked,
        notificationsCancelled,
      },
    },
    tx,
  )

  await tx.delete(user).where(eq(user.id, person.id))
}

export async function deleteUser(input: { actorId: string; userId: string }) {
  assertNotSelf(input.actorId, input.userId)
  await db.transaction(async (tx) => {
    await lockAgencyAdminRoster(tx)
    const person = await lockPerson(tx, input.userId)
    if (person.isAgencyAdmin && !person.blockedAt) {
      assertAgencyAdminCanBeRemoved(await countActiveAgencyAdmins(tx))
    }
    await removeAccount(tx, {
      person,
      actorId: input.actorId,
      actorName: await nameOf(tx, input.actorId),
      self: false,
    })
  })
}

/**
 * Self delete. The caller has already re-verified the person (password, or a
 * second factor, see `deleteMyAccountFn`). Refused while the person is the
 * only owner of a client or the last active agency admin.
 */
export async function deleteOwnAccount(input: { userId: string }) {
  await db.transaction(async (tx) => {
    await lockAgencyAdminRoster(tx)
    const person = await lockPerson(tx, input.userId)
    const blockers = await selfDeleteBlockersIn(tx, person, { lock: true })
    if (blockers.soleOwnerOf.length > 0) {
      throw new ConflictError(
        m.server_self_delete_sole_owner({
          clients: blockers.soleOwnerOf.join(', '),
        }),
      )
    }
    if (blockers.lastAdmin) throw new LastAgencyAdminError()
    await removeAccount(tx, {
      person,
      actorId: person.id,
      actorName: person.name,
      self: true,
    })
  })
}

export async function renameUser(input: {
  actorId: string
  userId: string
  name: string
}) {
  const name = input.name.trim()
  return db.transaction(async (tx) => {
    const person = await lockPerson(tx, input.userId)
    if (person.name === name) return
    await tx
      .update(user)
      .set({ name, updatedAt: new Date() })
      .where(eq(user.id, person.id))
    await audit(
      {
        organizationId: null,
        actorId: input.actorId,
        action: 'user.rename',
        targetType: 'user',
        targetId: person.id,
        meta: { userName: name, previousName: person.name },
      },
      tx,
    )
  })
}

/** Ends every session of the person. Admin-only: the self case is refused. */
export async function signOutEverywhere(input: {
  actorId: string
  userId: string
}) {
  assertNotSelf(input.actorId, input.userId)
  return db.transaction(async (tx) => {
    const person = await lockPerson(tx, input.userId)
    const ended = await tx
      .delete(session)
      .where(eq(session.userId, person.id))
      .returning({ id: session.id })
    await audit(
      {
        organizationId: null,
        actorId: input.actorId,
        action: 'user.sessions_revoke',
        targetType: 'user',
        targetId: person.id,
        meta: { userName: person.name, sessionsEnded: ended.length },
      },
      tx,
    )
    return { sessionsEnded: ended.length }
  })
}

/**
 * Removes the person's two-factor secret and backup codes, turns the flag off
 * and ends their sessions. Agency admins are asked to enrol again on their
 * next sign-in (existing behaviour); the person gets a security notice.
 */
export async function resetTwoFactor(input: {
  actorId: string
  userId: string
}) {
  assertNotSelf(input.actorId, input.userId)
  await db.transaction(async (tx) => {
    const person = await lockPerson(tx, input.userId)
    await tx.delete(twoFactor).where(eq(twoFactor.userId, person.id))
    await tx
      .update(user)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(user.id, person.id))
    await tx.delete(session).where(eq(session.userId, person.id))
    await audit(
      {
        organizationId: null,
        actorId: input.actorId,
        action: 'user.two_factor_reset',
        targetType: 'user',
        targetId: person.id,
        meta: { userName: person.name },
      },
      tx,
    )
    await sendAccountEmail({
      kind: 'two_factor_reset',
      userId: person.id,
      params: {
        userId: person.id,
        actorName: await nameOf(tx, input.actorId),
        at: new Date().toISOString(),
      },
      connection: tx,
    })
  })
}

/** Why a bulk action skipped a person. The UI words these. */
export type BulkSkipReason =
  'self' | 'last_active_admin' | 'already_member' | 'failed'

export type BulkSkip = {
  userId: string
  reason: BulkSkipReason
  message: string
}

export type BulkResult = { done: string[]; skipped: BulkSkip[] }

/**
 * Runs one action per person and keeps going past refusals. Each person is
 * its own transaction, so a refusal for one never undoes another's change.
 * The action may return a skip reason instead of throwing.
 */
export async function runBulk(
  actorId: string,
  userIds: string[],
  act: (userId: string) => Promise<BulkSkipReason | null>,
): Promise<BulkResult> {
  const done: string[] = []
  const skipped: BulkSkip[] = []
  for (const userId of new Set(userIds)) {
    if (userId === actorId) {
      skipped.push({
        userId,
        reason: 'self',
        message: m.server_cannot_act_on_self(),
      })
      continue
    }
    try {
      const reason = await act(userId)
      if (reason) {
        skipped.push({ userId, reason, message: skipMessage(reason) })
      } else {
        done.push(userId)
      }
    } catch (error) {
      if (error instanceof LastAgencyAdminError) {
        skipped.push({
          userId,
          reason: 'last_active_admin',
          message: error.message,
        })
      } else if (error instanceof AppError) {
        skipped.push({ userId, reason: 'failed', message: error.message })
      } else {
        throw error
      }
    }
  }
  return { done, skipped }
}

function skipMessage(reason: BulkSkipReason) {
  return reason === 'already_member'
    ? m.server_access_already_member_all()
    : m.server_cannot_act_on_self()
}

export function bulkBlockUsers(input: {
  actorId: string
  userIds: string[]
  reason?: string | null
}) {
  return runBulk(input.actorId, input.userIds, async (userId) => {
    await blockUser({ actorId: input.actorId, userId, reason: input.reason })
    return null
  })
}

export function bulkUnblockUsers(input: {
  actorId: string
  userIds: string[]
}) {
  return runBulk(input.actorId, input.userIds, async (userId) => {
    await unblockUser({ actorId: input.actorId, userId })
    return null
  })
}

export function bulkSignOutUsers(input: {
  actorId: string
  userIds: string[]
}) {
  return runBulk(input.actorId, input.userIds, async (userId) => {
    await signOutEverywhere({ actorId: input.actorId, userId })
    return null
  })
}

/** People whose names or emails match, most useful first. Agency admins only. */
export async function searchPeople(query: string, limit = 8) {
  const term = query.trim()
  if (!term) return []
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      blockedAt: user.blockedAt,
    })
    .from(user)
    .where(or(ilike(user.name, pattern), ilike(user.email, pattern)))
    .orderBy(user.name)
    .limit(limit)
  if (rows.length === 0) return []
  const pending = await db
    .select({ email: invitation.email })
    .from(invitation)
    .where(
      and(
        isNull(invitation.acceptedAt),
        inArray(
          invitation.email,
          rows.map((row) => row.email.toLowerCase()),
        ),
      ),
    )
  const invited = new Set(pending.map((row) => row.email))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    blocked: row.blockedAt !== null,
    invited: invited.has(row.email.toLowerCase()),
  }))
}
