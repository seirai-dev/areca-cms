/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * What publishing and invitations call. Each entry point runs after the
 * caller's own commit and never throws: a notification problem must not fail
 * a release or an invitation.
 */
import { and, asc, desc, eq, inArray, isNotNull, lte, ne } from 'drizzle-orm'

import { db } from '#/db'
import {
  auditLog,
  invitation,
  membership,
  organization,
  publication,
  site,
  user,
} from '#/db/schema'
import type { NotificationPayload, NotificationRole } from '#/lib/notifications'
import type { PublicationStatus, Snapshot } from '#/lib/types'
import { createLogger } from '#/server/log'
import { membershipRoles } from '#/server/security/org-role'
import { diffSnapshotCollections } from '#/server/publishing/release-diff'
import type { ReleaseDiffEntry } from '#/server/publishing/release-diff'

import { notify, notifyStrict } from './notify.ts'
import type { NotificationRecipient } from './notify.ts'

const log = createLogger('notifications')
const MAX_ENTRIES = 10
const WENT_LIVE_STATUSES: PublicationStatus[] = [
  'live',
  'superseded',
  'rolled_back',
]

type Entries = Pick<NotificationPayload, 'entries' | 'moreEntries'>

/**
 * Release, schedule and invite events for one site, with its org name. Null
 * for a development environment: dev envs create no notification events
 * (docs/design/dev-environments.md, Decision 22). Every caller returns early.
 */
async function siteContext(siteId: string) {
  const [row] = await db
    .select({
      siteId: site.id,
      siteName: site.name,
      organizationId: site.organizationId,
      orgName: organization.name,
    })
    .from(site)
    .innerJoin(organization, eq(organization.id, site.organizationId))
    .where(and(eq(site.id, siteId), eq(site.environment, 'production')))
    .limit(1)
  return row ?? null
}

/**
 * Each person's membership role, or 'agency' for an agency admin who is not a
 * member. Unlike `orgRoleOf`, membership wins here: an agency admin who is
 * also a member gets the org's events under that role, with the org's rules
 * and the per-org choices their Notifications settings show for it.
 */
async function recipientsFor(
  userIds: Array<string | null>,
  organizationId: string,
): Promise<NotificationRecipient[]> {
  const ids = [...new Set(userIds)].filter((id): id is string => Boolean(id))
  const roles = await membershipRoles(organizationId, ids)
  const others = ids.filter((id) => !roles.has(id))
  const agencyAdmins = new Set(
    others.length === 0
      ? []
      : (
          await db
            .select({ id: user.id })
            .from(user)
            .where(and(inArray(user.id, others), eq(user.isAgencyAdmin, true)))
        ).map((row) => row.id),
  )
  return ids.flatMap((userId): NotificationRecipient[] => {
    const role: NotificationRole | undefined =
      roles.get(userId) ?? (agencyAdmins.has(userId) ? 'agency' : undefined)
    return role ? [{ userId, role }] : []
  })
}

async function ownersOf(
  organizationId: string,
): Promise<NotificationRecipient[]> {
  const rows = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.role, 'owner'),
      ),
    )
  return rows.map((row) => ({ userId: row.userId, role: 'owner' }))
}

function uniqueRecipients(list: NotificationRecipient[]) {
  const byId = new Map<string, NotificationRecipient>()
  for (const recipient of list) {
    if (!byId.has(recipient.userId)) byId.set(recipient.userId, recipient)
  }
  return [...byId.values()]
}

/** Entries that changed against the previous live release, capped for the email. */
function entriesBetween(current: Snapshot, previous: Snapshot | null): Entries {
  const diff = diffSnapshotCollections(
    current.collections,
    previous?.collections,
  )
  const changes: {
    entry: ReleaseDiffEntry
    change: 'added' | 'updated' | 'removed'
  }[] = [
    ...diff.adds.map((entry) => ({ entry, change: 'added' as const })),
    ...diff.updates.map((entry) => ({ entry, change: 'updated' as const })),
    ...diff.removals.map((entry) => ({ entry, change: 'removed' as const })),
  ]
  const entries = changes.slice(0, MAX_ENTRIES).map(({ entry, change }) => ({
    title:
      typeof entry.data.title === 'string' && entry.data.title.trim()
        ? entry.data.title
        : entry.slug,
    collection:
      current.schema?.[entry.collectionKey]?.label ?? entry.collectionKey,
    change,
  }))
  const moreEntries = changes.length - entries.length
  return moreEntries > 0 ? { entries, moreEntries } : { entries }
}

async function publicationRow(publicationId: string) {
  const [row] = await db
    .select()
    .from(publication)
    .where(eq(publication.id, publicationId))
    .limit(1)
  return row ?? null
}

/** Latest live release before this one, the baseline for "what changed". */
async function previousLive(pub: typeof publication.$inferSelect) {
  const [row] = await db
    .select()
    .from(publication)
    .where(
      and(
        eq(publication.siteId, pub.siteId),
        eq(publication.status, 'live'),
        ne(publication.id, pub.id),
        lte(publication.createdAt, pub.createdAt),
      ),
    )
    .orderBy(desc(publication.createdAt))
    .limit(1)
  return row ?? null
}

/** Agency admins get the alert unless they already got the org event for this subject. */
async function alertAgencyAdmins(input: {
  organizationId: string
  subjectId: string
  notified: string[]
  payload: NotificationPayload
}) {
  const admins = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.isAgencyAdmin, true))
  const already = new Set(input.notified)
  await notifyStrict({
    event: 'agency.release.failed',
    organizationId: input.organizationId,
    subjectId: input.subjectId,
    recipients: admins
      .filter((admin) => !already.has(admin.id))
      .map((admin) => ({ userId: admin.id, role: 'agency' as const })),
    payload: input.payload,
  })
}

/**
 * A release went live (publication status `live`). Scheduled releases notify
 * the people who scheduled them; rollbacks tell owners; manual releases tell
 * the requester, and other owners get the `.others` variant.
 */
export async function notifyPublicationLive(publicationId: string) {
  try {
    await deliverPublicationLive(publicationId)
  } catch (error) {
    log.error('live notification failed', { publicationId, err: error })
  }
}

/**
 * Fans out the live notifications and throws on failure, so the publication
 * events loop can retry. `previousPublicationId` is the release that was live
 * before this one, read before it was superseded. Omitted: look it up now
 * (only correct before the supersede, so the worker always passes it).
 */
export async function deliverPublicationLive(
  publicationId: string,
  previousPublicationId?: string | null,
) {
  const pub = await publicationRow(publicationId)
  // Delivery can run after a newer release superseded this one, so accept
  // any status a release that went live can have by now.
  if (!pub || !WENT_LIVE_STATUSES.includes(pub.status)) return
  const context = await siteContext(pub.siteId)
  if (!context) return
  const previous =
    previousPublicationId === undefined
      ? await previousLive(pub)
      : previousPublicationId
        ? await publicationRow(previousPublicationId)
        : null
  const payload: NotificationPayload = {
    siteId: context.siteId,
    siteName: context.siteName,
    orgName: context.orgName,
    organizationId: context.organizationId,
    publicationId: pub.id,
    ...entriesBetween(pub.snapshot, previous?.snapshot ?? null),
  }
  const orgId = context.organizationId

  if (pub.origin === 'scheduled') {
    await notifyStrict({
      event: 'schedule.published',
      organizationId: orgId,
      subjectId: pub.id,
      recipients: await recipientsFor(pub.scheduledBy, orgId),
      payload,
    })
    return
  }

  const requester = pub.requestedBy
  if (pub.origin === 'rollback') {
    // The requester hears through release.live below, so only once.
    await notifyStrict({
      event: 'rollback.live',
      organizationId: orgId,
      subjectId: pub.id,
      recipients: (await ownersOf(orgId)).filter(
        (owner) => owner.userId !== requester,
      ),
      payload,
    })
  }
  await notifyStrict({
    event: 'release.live',
    organizationId: orgId,
    subjectId: pub.id,
    recipients: await recipientsFor([requester], orgId),
    payload,
  })
  if (pub.origin === 'manual') {
    const others = (await ownersOf(orgId)).filter(
      (owner) => owner.userId !== requester,
    )
    await notifyStrict({
      event: 'release.live.others',
      organizationId: orgId,
      subjectId: pub.id,
      recipients: others,
      payload,
    })
  }
}

/**
 * A release failed (`stuck` when its outcome is unknown). The requester, the
 * people who scheduled it and owners are told, then agency admins who did not
 * already hear about it.
 */
export async function notifyPublicationFailed(
  publicationId: string,
  opts: { stuck: boolean },
) {
  try {
    await deliverPublicationFailed(publicationId, opts)
  } catch (error) {
    log.error('failure notification failed', { publicationId, err: error })
  }
}

/** Throws on failure so the publication events loop retries it. */
export async function deliverPublicationFailed(
  publicationId: string,
  opts: { stuck: boolean },
) {
  const pub = await publicationRow(publicationId)
  if (!pub) return
  const context = await siteContext(pub.siteId)
  if (!context) return
  const orgId = context.organizationId
  const payload: NotificationPayload = {
    siteId: context.siteId,
    siteName: context.siteName,
    orgName: context.orgName,
    organizationId: orgId,
    publicationId: pub.id,
  }
  const involved = await recipientsFor(
    [pub.requestedBy, ...pub.scheduledBy],
    orgId,
  )
  const result = await notifyStrict({
    event: opts.stuck ? 'release.stuck' : 'release.failed',
    organizationId: orgId,
    subjectId: pub.id,
    recipients: uniqueRecipients([...involved, ...(await ownersOf(orgId))]),
    payload,
  })
  await alertAgencyAdmins({
    organizationId: orgId,
    subjectId: pub.id,
    notified: result.notified,
    payload,
  })
}

/** Subject and dedupe key of a failed scheduled publish: one per schedule approval. */
export function scheduleFailedSubject(siteId: string, fingerprint: string) {
  return `schedule:${siteId}:${fingerprint}`
}

/**
 * A scheduled publish could not start. Owners hear once per schedule approval.
 * Throws on failure so the events loop retries it. The state change that
 * records the failure queues the event (see `queueScheduleFailedEvent`).
 */
export async function deliverScheduleFailed(
  siteId: string,
  input: { scheduledBy: string[]; fingerprint: string },
) {
  const context = await siteContext(siteId)
  if (!context) return
  const orgId = context.organizationId
  const subjectId = scheduleFailedSubject(siteId, input.fingerprint)
  const payload: NotificationPayload = {
    siteId: context.siteId,
    siteName: context.siteName,
    orgName: context.orgName,
    organizationId: orgId,
  }
  const result = await notifyStrict({
    event: 'schedule.failed',
    organizationId: orgId,
    subjectId,
    recipients: uniqueRecipients([
      ...(await recipientsFor(input.scheduledBy, orgId)),
      ...(await ownersOf(orgId)),
    ]),
    payload,
  })
  await alertAgencyAdmins({
    organizationId: orgId,
    subjectId,
    notified: result.notified,
    payload,
  })
}

/** The person who sent the invitation hears when it is accepted. */
export async function notifyInviteAccepted(
  invitationId: string,
  acceptedUserId: string,
) {
  try {
    const [invite] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1)
    if (!invite) return
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, invite.organizationId))
      .limit(1)
    const [invitee] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, acceptedUserId))
      .limit(1)
    // The audit row written when the invitation was sent names its sender.
    const [sent] = await db
      .select({ actorId: auditLog.actorId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'member.invite'),
          eq(auditLog.targetId, invitationId),
          isNotNull(auditLog.actorId),
        ),
      )
      .orderBy(asc(auditLog.createdAt))
      .limit(1)
    if (!sent?.actorId) return
    await notify({
      event: 'invite.accepted',
      organizationId: invite.organizationId,
      subjectId: invitationId,
      recipients: await recipientsFor([sent.actorId], invite.organizationId),
      payload: {
        organizationId: invite.organizationId,
        orgName: org?.name,
        inviteeName: invitee?.name,
        inviteeEmail: invitee?.email,
        role: invite.role,
      },
    })
  } catch (error) {
    log.error('invite notification failed', { invitationId, err: error })
  }
}
