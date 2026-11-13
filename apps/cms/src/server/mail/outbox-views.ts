/** Agency → Mail read models: recent emails and the failure streak. */
import { and, desc, eq, gt, max, ne, or } from 'drizzle-orm'

import { db } from '#/db'
import { emailDeliveryAttempt, emailOutbox, mailSettings } from '#/db/schema'

import { mailFailureMessage } from './errors.ts'
import type { OutboxStatus } from './outbox.ts'
import { failureStreak, healthWindowStart } from './outbox-policy.ts'
import type { MailFailureCode } from './types.ts'

type OutboxRow = typeof emailOutbox.$inferSelect

const RECENT_LIMIT = 50
const RECENT_LIMIT_MAX = 200

/** Recent emails row for Agency → Mail. Error message is localized. */
export type RecentEmail = {
  id: string
  kind: string
  to: string
  subject: string
  status: OutboxStatus
  /** True while queued after at least one failed attempt. */
  retrying: boolean
  attempts: number
  createdAt: Date
  sentAt: Date | null
  nextAttemptAt: Date | null
  error: { code: MailFailureCode; message: string } | null
}

export type MailHealth = {
  /** Failed attempts since the last successful send (any row). */
  consecutiveFailures: number
  lastFailureAt: Date | null
  lastFailure: { code: MailFailureCode; message: string } | null
}

export async function listRecentEmails(opts: {
  limit?: number
  status?: 'failed'
}): Promise<RecentEmail[]> {
  const limit = Math.min(
    Math.max(opts.limit ?? RECENT_LIMIT, 1),
    RECENT_LIMIT_MAX,
  )
  // "Failed" includes rows still retrying: they need attention too.
  const filter =
    opts.status === 'failed'
      ? or(
          eq(emailOutbox.status, 'failed'),
          and(eq(emailOutbox.status, 'queued'), gt(emailOutbox.attempts, 0)),
        )
      : undefined
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(filter)
    .orderBy(desc(emailOutbox.createdAt))
    .limit(limit)
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    to: row.toAddress,
    subject: row.subject,
    status: row.status,
    retrying: row.status === 'queued' && row.attempts > 0,
    attempts: row.attempts,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    nextAttemptAt: row.nextAttemptAt,
    error: errorOf(row),
  }))
}

/** Attempts read for the failure streak. Longer streaks read the same as this. */
const STREAK_SAMPLE = 50

export async function getMailHealth(): Promise<MailHealth> {
  // Test emails use unsaved settings, so they say nothing about live sending.
  const live = ne(emailOutbox.kind, 'test')
  const latest = (
    await db
      .select({ sentAt: max(emailOutbox.sentAt) })
      .from(emailOutbox)
      .where(live)
  ).at(0)
  const settings = (
    await db
      .select({ updatedAt: mailSettings.updatedAt })
      .from(mailSettings)
      .limit(1)
  ).at(0)
  // Failures count from the last success, or from the last settings change
  // (a new server deserves a fresh start).
  const since = healthWindowStart(
    latest?.sentAt ?? null,
    settings?.updatedAt ?? null,
  )
  // Counted per delivery attempt, so one row that failed three times counts
  // three times, and a row that has not been tried yet counts nothing.
  const recent = await db
    .select({
      outcome: emailDeliveryAttempt.outcome,
      createdAt: emailDeliveryAttempt.createdAt,
      errorCode: emailDeliveryAttempt.errorCode,
      errorParams: emailDeliveryAttempt.errorParams,
    })
    .from(emailDeliveryAttempt)
    .where(gt(emailDeliveryAttempt.createdAt, since))
    .orderBy(
      desc(emailDeliveryAttempt.createdAt),
      desc(emailDeliveryAttempt.attempt),
    )
    .limit(STREAK_SAMPLE)
  const { consecutiveFailures, last } = failureStreak(recent)
  return {
    consecutiveFailures,
    lastFailureAt: last?.createdAt ?? null,
    lastFailure:
      last?.errorCode && last.errorParams
        ? errorOfAttempt(last.errorCode, last.errorParams)
        : null,
  }
}

function errorOfAttempt(code: string, params: Record<string, string>) {
  return {
    code: code as MailFailureCode,
    message: mailFailureMessage({ code: code as MailFailureCode, params }),
  }
}

function errorOf(row: OutboxRow) {
  if (!row.lastErrorCode) return null
  const code = row.lastErrorCode as MailFailureCode
  return {
    code,
    message: mailFailureMessage({ code, params: row.lastErrorParams ?? {} }),
  }
}
