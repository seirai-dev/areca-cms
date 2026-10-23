/**
 * Durable notifications for release outcomes and failed scheduled publishes.
 * The state change and its event row commit together (`queuePublicationEvent`
 * and `queueScheduleFailedEvent` run in that transaction), so a crash after the
 * commit cannot lose the notice. `processPublicationEvents` delivers pending
 * events with retries. Re-delivery is safe because each recipient's row and
 * email share a dedupe key (see `notify.ts`).
 */
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import { notificationEvent } from '#/db/schema'
import { createLogger, redactString } from '#/server/log'

import {
  deliverPublicationFailed,
  deliverPublicationLive,
  deliverScheduleFailed,
  scheduleFailedSubject,
} from './triggers.ts'

type Connection = Pick<typeof db, 'insert'>
type NotificationEventRow = typeof notificationEvent.$inferSelect

const log = createLogger('notifications')

/** A claimed event is hidden from other loops for this long. */
const LEASE_MS = 5 * 60_000
const MAX_ATTEMPTS = 8
const BATCH_SIZE = 20

/** Wait after failed attempt n (1-based). */
export function eventRetryDelayMs(attempt: number) {
  const minutes = [0.5, 2, 10, 60][attempt - 1] ?? 60
  return minutes * 60_000
}

/**
 * Queues the notice for a release outcome. Pass the transaction that changes
 * the publication, so both commit or neither does. A repeat for the same
 * publication and kind is ignored.
 */
export async function queuePublicationEvent(
  connection: Connection,
  input: {
    kind: 'publication.live' | 'publication.failed'
    siteId: string
    publicationId: string
    payload?: NotificationEventRow['payload']
  },
) {
  await insertEvent(connection, {
    kind: input.kind,
    siteId: input.siteId,
    publicationId: input.publicationId,
    dedupeKey: input.publicationId,
    payload: input.payload,
  })
}

/**
 * Queues the notice for a scheduled publish that could not start. Pass the
 * transaction that records the failure. One notice per schedule approval, so a
 * repeat for the same approval is ignored.
 */
export async function queueScheduleFailedEvent(
  connection: Connection,
  input: { siteId: string; fingerprint: string; scheduledBy: string[] },
) {
  await insertEvent(connection, {
    kind: 'schedule.failed',
    siteId: input.siteId,
    publicationId: null,
    dedupeKey: scheduleFailedSubject(input.siteId, input.fingerprint),
    payload: { scheduledBy: input.scheduledBy, fingerprint: input.fingerprint },
  })
}

async function insertEvent(
  connection: Connection,
  input: {
    kind: NotificationEventRow['kind']
    siteId: string
    publicationId: string | null
    dedupeKey: string
    payload?: NotificationEventRow['payload']
  },
) {
  await connection
    .insert(notificationEvent)
    .values({
      kind: input.kind,
      siteId: input.siteId,
      publicationId: input.publicationId,
      dedupeKey: input.dedupeKey,
      payload: input.payload ?? {},
      nextAttemptAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [notificationEvent.kind, notificationEvent.dedupeKey],
    })
}

/** Delivers due events. Each claim is a conditional update, so replicas never share one. */
export async function processPublicationEvents(
  opts: {
    /** Tests only: limit the tick to these publications or sites (the table is shared). */
    only?: { publicationIds?: readonly string[]; siteIds?: readonly string[] }
    /** Raised at shutdown: no new event is claimed after it. */
    signal?: AbortSignal
  } = {},
): Promise<number> {
  const due = await db
    .select()
    .from(notificationEvent)
    .where(
      and(
        eq(notificationEvent.status, 'pending'),
        lte(notificationEvent.nextAttemptAt, sql`now()`),
        opts.only
          ? or(
              opts.only.publicationIds
                ? inArray(notificationEvent.publicationId, [
                    ...opts.only.publicationIds,
                  ])
                : undefined,
              opts.only.siteIds
                ? inArray(notificationEvent.siteId, [...opts.only.siteIds])
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(asc(notificationEvent.createdAt))
    .limit(BATCH_SIZE)

  for (const event of due) {
    if (opts.signal?.aborted) break
    const claimed = await db
      .update(notificationEvent)
      .set({
        attempts: sql`${notificationEvent.attempts} + 1`,
        nextAttemptAt: new Date(Date.now() + LEASE_MS),
      })
      .where(
        and(
          eq(notificationEvent.id, event.id),
          eq(notificationEvent.status, 'pending'),
          eq(notificationEvent.attempts, event.attempts),
        ),
      )
      .returning({ id: notificationEvent.id })
    if (claimed.length === 0) continue

    const attempt = event.attempts + 1
    try {
      await deliver(event)
      await db
        .update(notificationEvent)
        .set({
          status: 'done',
          nextAttemptAt: null,
          lastError: null,
          processedAt: new Date(),
        })
        .where(eq(notificationEvent.id, event.id))
    } catch (error) {
      const exhausted = attempt >= MAX_ATTEMPTS
      await db
        .update(notificationEvent)
        .set({
          status: exhausted ? 'failed' : 'pending',
          nextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + eventRetryDelayMs(attempt)),
          lastError: redactString(
            error instanceof Error ? error.message : String(error),
          ),
        })
        .where(eq(notificationEvent.id, event.id))
      log.error(
        exhausted
          ? 'release notification gave up after retries'
          : 'release notification failed; will retry',
        {
          eventId: event.id,
          kind: event.kind,
          publicationId: event.publicationId,
          attempt,
          err: error,
        },
      )
    }
  }
  return due.length
}

async function deliver(event: NotificationEventRow) {
  if (event.kind === 'schedule.failed') {
    const fingerprint = event.payload.fingerprint
    if (!fingerprint) throw new Error('schedule event has no fingerprint')
    await deliverScheduleFailed(event.siteId, {
      scheduledBy: event.payload.scheduledBy ?? [],
      fingerprint,
    })
    return
  }
  if (!event.publicationId) {
    throw new Error(`${event.kind} event has no publication`)
  }
  if (event.kind === 'publication.live') {
    await deliverPublicationLive(
      event.publicationId,
      event.payload.previousPublicationId,
    )
    return
  }
  await deliverPublicationFailed(event.publicationId, {
    stuck: event.payload.stuck ?? false,
  })
}
