/**
 * Durable release notifications. The publication state change and its event
 * row commit together (`queuePublicationEvent` runs in that transaction), so a
 * crash after the commit cannot lose the notice. `processPublicationEvents`
 * delivers pending events with retries. Re-delivery is safe because each
 * recipient's row and email share a dedupe key (see `notify.ts`).
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'

import { db } from '#/db'
import { notificationEvent } from '#/db/schema'
import { createLogger, redactString } from '#/server/log'

import { deliverPublicationFailed, deliverPublicationLive } from './triggers.ts'

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
    kind: NotificationEventRow['kind']
    siteId: string
    publicationId: string
    payload?: NotificationEventRow['payload']
  },
) {
  await connection
    .insert(notificationEvent)
    .values({
      kind: input.kind,
      siteId: input.siteId,
      publicationId: input.publicationId,
      payload: input.payload ?? {},
      nextAttemptAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [notificationEvent.kind, notificationEvent.publicationId],
    })
}

/** Delivers due events. Each claim is a conditional update, so replicas never share one. */
export async function processPublicationEvents(
  /** Tests only: limit the tick to these publications (the table is shared). */
  opts: { only?: readonly string[] } = {},
): Promise<number> {
  const due = await db
    .select()
    .from(notificationEvent)
    .where(
      and(
        eq(notificationEvent.status, 'pending'),
        lte(notificationEvent.nextAttemptAt, sql`now()`),
        opts.only
          ? inArray(notificationEvent.publicationId, [...opts.only])
          : undefined,
      ),
    )
    .orderBy(asc(notificationEvent.createdAt))
    .limit(BATCH_SIZE)

  for (const event of due) {
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
