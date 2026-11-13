/**
 * Notification fan-out. One call stores a `notification` row per recipient
 * whose preference resolves on, and queues the email for verified addresses
 * when mail is configured. Never throws: callers run after their own commit.
 */
import { inArray, lt, sql } from 'drizzle-orm'

import { db } from '#/db'
import { notification, user } from '#/db/schema'
import { eventReachesRole } from '#/lib/notifications'
import type {
  EventKey,
  NotificationPayload,
  NotificationRole,
} from '#/lib/notifications'
import { createLogger } from '#/server/log'
import { isMailConfigured } from '#/server/mail/config'
import { enqueueEmail } from '#/server/mail/outbox'

import {
  choiceKey,
  choiceOrganization,
  loadAgencyRules,
  loadOrganizationRules,
  loadUserChoices,
  resolvePreference,
  ruleKey,
} from './preferences.ts'

export type { NotificationPayload } from '#/lib/notifications'

export type NotificationRecipient = { userId: string; role: NotificationRole }

const log = createLogger('notifications')
const RETENTION_SQL = sql`now() - interval '30 days'`

/**
 * Stores and queues one event for its recipients. `subjectId` (publication,
 * invitation, schedule…) makes the dedupe key, so a repeat call is harmless.
 * `notified` lists the users who have a row for this subject afterwards,
 * whether it was created now or earlier.
 */
export type NotifyInput = {
  event: EventKey
  organizationId: string | null
  /** Publication id, invitation id, … — makes the dedupe key. */
  subjectId: string
  recipients: NotificationRecipient[]
  payload: NotificationPayload
}

export async function notify(
  input: NotifyInput,
): Promise<{ notified: string[] }> {
  try {
    return await notifyStrict(input)
  } catch (error) {
    log.error('notification fan-out failed', {
      event: input.event,
      subjectId: input.subjectId,
      organizationId: input.organizationId,
      err: error,
    })
    return { notified: [] }
  }
}

/**
 * `notify`, but a failure is thrown. Retrying the same call is safe: each
 * recipient's row and email are created together under the dedupe key, so an
 * earlier partial run only means fewer rows left to create.
 */
export async function notifyStrict(
  input: NotifyInput,
): Promise<{ notified: string[] }> {
  return deliver(input)
}

async function deliver(input: NotifyInput): Promise<{ notified: string[] }> {
  const { event, organizationId, subjectId, payload } = input
  const seen = new Set<string>()
  const recipients = input.recipients.filter((recipient) => {
    if (seen.has(recipient.userId)) return false
    seen.add(recipient.userId)
    // Organization roles need an organization. Agency-role alerts do not.
    if (recipient.role !== 'agency' && !organizationId) return false
    return eventReachesRole(event, recipient.role)
  })
  if (recipients.length === 0) return { notified: [] }

  const userIds = recipients.map((recipient) => recipient.userId)
  const [users, agencyRules, orgRules, choices, mailReady] = await Promise.all([
    db
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        locale: user.locale,
        blockedAt: user.blockedAt,
      })
      .from(user)
      .where(inArray(user.id, userIds)),
    loadAgencyRules(),
    organizationId ? loadOrganizationRules(organizationId) : null,
    loadUserChoices(userIds),
    isMailConfigured(),
  ])
  const usersById = new Map(users.map((row) => [row.id, row]))

  const planned = recipients.flatMap((recipient) => {
    const row = usersById.get(recipient.userId)
    // A blocked person gets no notices, new or queued.
    if (!row || row.blockedAt) return []
    const key = ruleKey(event, recipient.role)
    const resolved = resolvePreference({
      event,
      role: recipient.role,
      agencyRule: agencyRules.get(key),
      orgRule: orgRules?.get(key),
      userChoice: choices.get(
        choiceKey(
          recipient.userId,
          choiceOrganization(recipient.role, organizationId),
          event,
        ),
      ),
    })
    if (!resolved.enabled) return []
    return [
      {
        row,
        role: recipient.role,
        lockedBy: resolved.lockedBy,
        dedupeKey: `${event}:${subjectId}:${recipient.userId}`,
      },
    ]
  })
  if (planned.length === 0) return { notified: [] }

  await db.transaction(async (tx) => {
    for (const item of planned) {
      const created = (
        await tx
          .insert(notification)
          .values({
            userId: item.row.id,
            organizationId,
            siteId: payload.siteId ?? null,
            event,
            payload: {
              ...payload,
              recipientRole: item.role,
              lockedBy: item.lockedBy,
            },
            dedupeKey: item.dedupeKey,
          })
          .onConflictDoNothing({ target: notification.dedupeKey })
          .returning({ id: notification.id })
      ).at(0)
      if (!created) continue
      // Only verified addresses get email. The in-app row is kept either way.
      if (!item.row.emailVerified || !mailReady) continue
      await enqueueEmail(
        {
          kind: event,
          template: 'notification',
          to: item.row.email,
          params: { userId: item.row.id, notificationId: created.id },
          locale: item.row.locale,
          userId: item.row.id,
          organizationId,
          notificationId: created.id,
        },
        tx,
      )
    }
  })

  const existing = await db
    .select({ userId: notification.userId })
    .from(notification)
    .where(
      inArray(
        notification.dedupeKey,
        planned.map((item) => item.dedupeKey),
      ),
    )
  return { notified: [...new Set(existing.map((row) => row.userId))] }
}

/** Deletes notification rows older than 30 days. */
export async function cleanupNotifications(): Promise<number> {
  const deleted = await db
    .delete(notification)
    .where(lt(notification.createdAt, RETENTION_SQL))
    .returning({ id: notification.id })
  return deleted.length
}
