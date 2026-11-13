/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * Email outbox: every email is a row in `email_outbox`. User-triggered sends
 * try immediately (`sendNow`); the worker loop retries the rest.
 *
 * CONTRACT (agreed by the orchestrator). Task A2 implements the bodies; the
 * Mail tab (task B) codes against these signatures. Do not change them
 * without updating both.
 */
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor } from '#/db'
import {
  emailDeliveryAttempt,
  emailOutbox,
  invitation,
  mailSettings,
  user,
} from '#/db/schema'
import { getBranding } from '#/server/admin/branding'
import { createLogger } from '#/server/log'
import { notificationStillEligible } from '#/server/notifications/eligibility'

import { resolveMailConfig } from './config.ts'
import {
  MailConfigError,
  logMailFailure,
  mailFailureMessage,
  toMailFailure,
} from './errors.ts'
import type { MailLogContext } from './errors.ts'
import { formatFrom } from './headers.ts'
import {
  failureStreak,
  healthWindowStart,
  invitationDeliveryPatch,
  nextStep,
} from './outbox-policy.ts'
import type { InvitationDeliveryStatus } from './outbox-policy.ts'
import { mailLocale, MailRenderError, renderTemplate } from './render/index.ts'
import type { MailLocale } from './render/index.ts'
import { draftToConfig } from './settings.ts'
import type { MailDraft } from './settings.ts'
import { sendMail } from './transport.ts'
import { MAIL_MAX_ATTEMPTS } from './types.ts'
import type {
  MailConfig,
  MailFailure,
  MailFailureCode,
  MailMessage,
} from './types.ts'

/** Template names. Each has a renderer in `render/templates/`. */
export type MailTemplate =
  | 'invitation'
  | 'test'
  | 'password_reset'
  | 'password_reset_sso'
  | 'verify_email'
  | 'password_changed'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'membership_removed'
  | 'membership_role_changed'
  | 'membership_added'
  | 'agency_admin_granted'
  | 'agency_admin_revoked'
  | 'account_deleted'
  | 'two_factor_reset'
  | 'notification'

/** 'cancelled': a notification email skipped at send time; not a failure. */
export type OutboxStatus =
  'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'

export type EnqueueEmailInput = {
  /** Account email kind, notification event key, or 'test'. */
  kind: string
  template: MailTemplate
  to: string
  /** Template params. Never put tokens or links here; pass ids instead. */
  params: Record<string, unknown>
  /**
   * Values merged over `params` only to render the subject. Never stored.
   * Tokens that a template needs for its body go to `sendNow` instead.
   */
  renderParams?: Record<string, unknown>
  /** Recipient language ('en' | 'nl' | 'tr'). Falls back to 'en'. */
  locale?: string | null
  userId?: string | null
  organizationId?: string | null
  notificationId?: string | null
  /**
   * The caller sends this row itself right after the write (`sendNow` with
   * `claimedAttempt`). Inserted already claimed, so the worker waits.
   */
  immediate?: boolean
}

/** A new row. `claimedAttempt` is set when the caller owns its first attempt. */
export type EnqueuedEmail = { id: string; claimedAttempt?: number }

export type SendResult =
  | { status: 'sent'; id: string }
  /** Retryable failure: the worker tries again at `nextAttemptAt`. */
  | {
      status: 'retrying'
      id: string
      failure: MailFailure
      nextAttemptAt: Date
    }
  | { status: 'failed'; id: string; failure: MailFailure }
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

type OutboxRow = typeof emailOutbox.$inferSelect

const log = createLogger('mail')

const LEASE_MS = 60_000
/** Renewed well inside the lease while a send is in flight. */
const LEASE_RENEW_MS = 15_000
/** The first attempt, made by the immediate sender of user actions. */
const IMMEDIATE_ATTEMPT = 1
const BATCH_SIZE = 20
/** 5 sends per second. */
const SEND_INTERVAL_MS = 200
const RECENT_LIMIT = 50
const RECENT_LIMIT_MAX = 200

/**
 * Inserts a row. Pass a transaction to enqueue atomically. With `immediate`,
 * the row is inserted already claimed by the caller (attempt 1, lease set), so
 * the worker cannot send it while the caller is about to. If the caller never
 * sends it, the lease expires and the worker takes over.
 */
export async function enqueueEmail(
  input: EnqueueEmailInput,
  executor: DbExecutor = db,
): Promise<EnqueuedEmail> {
  const locale = mailLocale(input.locale)
  const subject = await renderSubject(input, locale, executor)
  const [row] = await executor
    .insert(emailOutbox)
    .values({
      kind: input.kind,
      toAddress: input.to,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      notificationId: input.notificationId ?? null,
      subject,
      template: input.template,
      params: input.params,
      locale,
      ...(input.immediate
        ? {
            status: 'sending' as const,
            attempts: IMMEDIATE_ATTEMPT,
            leaseUntil: leaseFromNow(),
            nextAttemptAt: null,
          }
        : {
            status: 'queued' as const,
            attempts: 0,
            nextAttemptAt: new Date(),
          }),
    })
    .returning({ id: emailOutbox.id })
  if (!row) throw new Error('Failed to queue email')
  return input.immediate
    ? { id: row.id, claimedAttempt: IMMEDIATE_ATTEMPT }
    : { id: row.id }
}

/** The subject is stored for the log. A render problem must not block queuing. */
async function renderSubject(
  input: EnqueueEmailInput,
  locale: MailLocale,
  connection: DbExecutor,
): Promise<string> {
  try {
    const rendered = await renderTemplate(
      input.template,
      { ...input.params, ...input.renderParams },
      { locale, brand: await getBranding(), connection },
    )
    return rendered.subject
  } catch (error) {
    log.warn('could not render email subject', { kind: input.kind, err: error })
    return input.kind
  }
}

/**
 * Tries to send a row now (attempt 1 for user actions). `renderParams` are
 * merged over the stored params for this attempt only.
 *
 * With `claimedAttempt` (from `enqueueEmail({ immediate })`), the caller already
 * owns that attempt, so the row is sent as is. If the lease ran out and the
 * worker claimed it again, the caller gets that state instead of sending twice.
 */
export async function sendNow(
  id: string,
  opts: {
    renderParams?: Record<string, unknown>
    claimedAttempt?: number
  } = {},
): Promise<SendResult> {
  if (opts.claimedAttempt !== undefined) {
    const [owned] = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.id, id),
          eq(emailOutbox.attempts, opts.claimedAttempt),
          eq(emailOutbox.status, 'sending'),
        ),
      )
      .limit(1)
    if (owned) return sendClaimed(owned, opts.renderParams)
  } else {
    const [claimed] = await db
      .update(emailOutbox)
      .set({
        status: 'sending',
        leaseUntil: new Date(Date.now() + LEASE_MS),
        attempts: sql`${emailOutbox.attempts} + 1`,
      })
      .where(and(eq(emailOutbox.id, id), eq(emailOutbox.status, 'queued')))
      .returning()
    if (claimed) return sendClaimed(claimed, opts.renderParams)
  }

  // Already sent, being sent by the worker, or failed: report that state.
  const [current] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, id))
    .limit(1)
  if (!current) throw new Error(`Email ${id} not found`)
  return resultOf(current)
}

/**
 * One worker tick. Lists due rows, then claims each one immediately before
 * sending it, paced at 5/s. A claim only lasts one lease, so a batch never
 * sits leased while earlier sends wait their turn.
 */
export async function processOutbox(
  opts: {
    /** Tests only: limit the tick to these rows (the table is shared). */
    only?: readonly string[]
    /** Raised at shutdown: no new claim starts after it. */
    signal?: AbortSignal
  } = {},
): Promise<number> {
  await failExhaustedRows()
  const candidates = await dueCandidates(opts.only)
  let claimed = 0
  for (const [index, id] of candidates.entries()) {
    if (opts.signal?.aborted) break
    if (index > 0) await sleep(SEND_INTERVAL_MS)
    if (opts.signal?.aborted) break
    try {
      const row = await claimById(id)
      // Another replica claimed it, or it stopped being due: skip it.
      if (!row) continue
      claimed++
      if (
        row.notificationId &&
        !(await notificationStillEligible(row.notificationId))
      ) {
        await cancelUndelivered(row)
        continue
      }
      await sendClaimed(row)
    } catch (error) {
      log.error('outbox row could not be recorded', {
        outboxId: id,
        err: error,
      })
    }
  }
  return claimed
}

/** Deletes rows older than 30 days. */
export async function cleanupOutbox(): Promise<number> {
  const deleted = await db
    .delete(emailOutbox)
    .where(lt(emailOutbox.createdAt, sql`now() - interval '30 days'`))
    .returning({ id: emailOutbox.id })
  return deleted.length
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
  const [latest] = await db
    .select({ sentAt: max(emailOutbox.sentAt) })
    .from(emailOutbox)
    .where(live)
  const [settings] = await db
    .select({ updatedAt: mailSettings.updatedAt })
    .from(mailSettings)
    .limit(1)
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

/**
 * Sends the 'test' template to `to` using unsaved form values (not the active
 * config), and records the attempt as a `kind: 'test'` outbox row with its
 * final status so it shows in Recent emails. Never retried.
 * Lives here so the Mail tab server fn stays a thin wrapper.
 */
export async function sendTestEmail(input: {
  draft: MailDraft
  to: string
  locale?: string | null
  userId: string
}): Promise<SendResult> {
  const locale = mailLocale(input.locale)
  const [sender] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  const brand = await getBranding()
  const host = input.draft.host.trim()
  const params = { host, sentBy: sender?.email ?? '' }
  const rendered = await renderTemplate('test', params, { locale, brand })
  const [row] = await db
    .insert(emailOutbox)
    .values({
      kind: 'test',
      toAddress: input.to,
      userId: input.userId,
      subject: rendered.subject,
      template: 'test',
      params,
      locale,
      status: 'sending',
      attempts: 1,
    })
    .returning()
  if (!row) throw new Error('Failed to record test email')

  let config: MailConfig | null = null
  let messageId: string
  try {
    config = await draftToConfig(input.draft)
    const sent = await sendMail(config, {
      from: formatFrom(config.from, brand.emailFromName ?? brand.appName),
      to: input.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    })
    messageId = sent.messageId
  } catch (error) {
    const context: MailLogContext = {
      host,
      port: input.draft.port,
      secure: input.draft.secure,
      from: input.draft.fromAddress.trim(),
      to: input.to,
      outboxId: row.id,
      secrets: [input.draft.password, config?.password, ...rendered.secrets],
      kind: 'test',
      attempt: 1,
      error,
    }
    // Test sends are never retried, so the failure is reported as final.
    const failure = { ...toMailFailure(error, context), retryable: false }
    logMailFailure(log, failure, context)
    await db
      .update(emailOutbox)
      .set({ status: 'failed', ...errorColumns(failure) })
      .where(eq(emailOutbox.id, row.id))
    return { status: 'failed', id: row.id, failure }
  }
  await db
    .update(emailOutbox)
    .set({
      status: 'sent',
      sentAt: new Date(),
      providerMessageId: messageId,
      lastErrorCode: null,
      lastErrorParams: null,
      lastError: null,
    })
    .where(eq(emailOutbox.id, row.id))
  return { status: 'sent', id: row.id }
}

/**
 * Cancels queued invitation emails for one invitation. A resend creates a new
 * row, so older ones would otherwise send the same link again.
 */
export async function supersedeInvitationEmails(
  invitationId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(emailOutbox)
    .set({
      status: 'failed',
      nextAttemptAt: null,
      leaseUntil: null,
      lastErrorCode: 'unknown',
      lastErrorParams: sql`jsonb_build_object('reply', 'superseded by a newer invitation email', 'id', ${emailOutbox.id})`,
      lastError: 'Superseded by a newer invitation email.',
    })
    .where(
      and(
        eq(emailOutbox.kind, 'invitation'),
        eq(emailOutbox.status, 'queued'),
        sql`${emailOutbox.params}->>'invitationId' = ${invitationId}`,
      ),
    )
}

/**
 * Cancels a user's queued notification emails for one organization, e.g. after
 * they leave it. Account emails are not touched.
 */
export async function cancelQueuedNotificationEmails(
  userId: string,
  organizationId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const cancelled = await executor
    .update(emailOutbox)
    .set({ status: 'cancelled', nextAttemptAt: null, leaseUntil: null })
    .where(
      and(
        eq(emailOutbox.userId, userId),
        eq(emailOutbox.organizationId, organizationId),
        eq(emailOutbox.status, 'queued'),
        isNotNull(emailOutbox.notificationId),
      ),
    )
    .returning({ id: emailOutbox.id })
  return cancelled.length
}

/**
 * Cancels every queued notification email for a person, in any client. Used
 * when they are blocked or deleted: a suspended or gone person gets nothing.
 */
export async function cancelAllQueuedNotificationEmails(
  userId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const cancelled = await executor
    .update(emailOutbox)
    .set({ status: 'cancelled', nextAttemptAt: null, leaseUntil: null })
    .where(
      and(
        eq(emailOutbox.userId, userId),
        eq(emailOutbox.status, 'queued'),
        isNotNull(emailOutbox.notificationId),
      ),
    )
    .returning({ id: emailOutbox.id })
  return cancelled.length
}

/** Rows a worker may claim now: due, or leased to a sender that stopped. */
function claimable() {
  return or(
    and(
      eq(emailOutbox.status, 'queued'),
      lte(emailOutbox.nextAttemptAt, sql`now()`),
    ),
    and(
      eq(emailOutbox.status, 'sending'),
      lt(emailOutbox.leaseUntil, sql`now()`),
      lt(emailOutbox.attempts, MAIL_MAX_ATTEMPTS),
    ),
  )
}

/** Ids of due rows, oldest first. Not claimed: `claimById` does that. */
async function dueCandidates(only?: readonly string[]): Promise<string[]> {
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(only ? inArray(emailOutbox.id, [...only]) : undefined, claimable()),
    )
    .orderBy(
      sql`coalesce(${emailOutbox.nextAttemptAt}, ${emailOutbox.createdAt})`,
    )
    .limit(BATCH_SIZE)
  return rows.map((row) => row.id)
}

/**
 * Claims one row if it is still due, in a single conditional UPDATE. The
 * `attempts` increment is the fence: every outcome write checks it. Two
 * replicas cannot both win, because the loser's WHERE sees the new lease.
 */
async function claimById(id: string): Promise<OutboxRow | null> {
  const [row] = await db
    .update(emailOutbox)
    .set({
      status: 'sending',
      leaseUntil: leaseFromNow(),
      attempts: sql`${emailOutbox.attempts} + 1`,
    })
    .where(and(eq(emailOutbox.id, id), claimable()))
    .returning()
  return row ?? null
}

function leaseFromNow() {
  return new Date(Date.now() + LEASE_MS)
}

/** Keeps the lease alive while SMTP is in flight. A stale write is a no-op. */
function keepLease(row: OutboxRow) {
  const timer = setInterval(() => {
    void db
      .update(emailOutbox)
      .set({ leaseUntil: leaseFromNow() })
      .where(ownedBy(row))
      .catch((error: unknown) =>
        log.error('mail lease renewal failed', {
          outboxId: row.id,
          err: error,
        }),
      )
  }, LEASE_RENEW_MS)
  return () => clearInterval(timer)
}

/** The write matches only while this claim still owns the row. */
function ownedBy(row: Pick<OutboxRow, 'id' | 'attempts'>) {
  return and(
    eq(emailOutbox.id, row.id),
    eq(emailOutbox.attempts, row.attempts),
    eq(emailOutbox.status, 'sending'),
  )
}

/**
 * Rows whose sender died on the last allowed attempt cannot be retried, so
 * they are closed here instead of being sent a fourth time.
 */
async function failExhaustedRows() {
  const closed = await db
    .update(emailOutbox)
    .set({
      status: 'failed',
      nextAttemptAt: null,
      leaseUntil: null,
      lastErrorCode: 'unknown',
      lastErrorParams: sql`jsonb_build_object('reply', 'sending was interrupted', 'id', ${emailOutbox.id})`,
      lastError: 'Sending was interrupted before it finished.',
    })
    .where(
      and(
        eq(emailOutbox.status, 'sending'),
        lt(emailOutbox.leaseUntil, sql`now()`),
        gte(emailOutbox.attempts, MAIL_MAX_ATTEMPTS),
      ),
    )
    .returning()
  const now = new Date()
  for (const row of closed) {
    await syncInvitation(
      row,
      invitationDeliveryPatch(
        'failed',
        mailFailureMessage({
          code: 'unknown',
          params: row.lastErrorParams ?? {},
        }),
        now,
      ),
    )
  }
}

/** Sends a claimed row (status 'sending') and records the outcome. */
async function sendClaimed(
  row: OutboxRow,
  renderParams?: Record<string, unknown>,
): Promise<SendResult> {
  const stopLease = keepLease(row)
  try {
    return await deliver(row, renderParams)
  } finally {
    stopLease()
  }
}

async function deliver(
  row: OutboxRow,
  renderParams?: Record<string, unknown>,
): Promise<SendResult> {
  let config: MailConfig | null = null
  let secrets: string[] = []
  let messageId: string
  try {
    config = await resolveMailConfig()
    if (!config) throw new MailConfigError('not_configured')
    const brand = await getBranding()
    const rendered = await renderTemplate(
      row.template as MailTemplate,
      { ...row.params, ...renderParams },
      { locale: mailLocale(row.locale), brand },
    )
    secrets = rendered.secrets
    const message: MailMessage = {
      from: formatFrom(config.from, brand.emailFromName ?? brand.appName),
      to: row.toAddress,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: rendered.headers,
    }
    messageId = (await sendMail(config, message)).messageId
  } catch (error) {
    const context: MailLogContext = {
      host: config?.host,
      port: config?.port,
      secure: config?.secure,
      from: config?.from,
      to: row.toAddress,
      outboxId: row.id,
      secrets: [config?.password, ...secrets],
      kind: row.kind,
      attempt: row.attempts,
      error,
    }
    const failure =
      error instanceof MailRenderError
        ? renderFailure(row, error)
        : toMailFailure(error, context)
    return recordFailure(row, failure, context)
  }
  return recordSent(row, messageId)
}

/** A template that cannot be built is final: retrying cannot fix it. */
function renderFailure(row: OutboxRow, error: MailRenderError): MailFailure {
  return {
    code: 'unknown',
    params: { reply: error.message, id: row.id },
    detail: error.message,
    retryable: false,
    ref: row.id,
  }
}

/**
 * Records a successful send. Only the claim that still owns the row may write;
 * a stale sender (its lease expired and another claim took over) is ignored.
 */
async function recordSent(
  row: OutboxRow,
  providerMessageId: string,
): Promise<SendResult> {
  const now = new Date()
  const written = await writeOutcome(
    row,
    {
      status: 'sent',
      sentAt: now,
      providerMessageId,
      leaseUntil: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorParams: null,
      lastError: null,
    },
    { outcome: 'sent' },
  )
  if (!written) return staleOutcome(row)
  await syncInvitation(row, invitationDeliveryPatch('sent', null, now))
  return { status: 'sent', id: row.id }
}

async function recordFailure(
  row: OutboxRow,
  failure: MailFailure,
  context: MailLogContext,
): Promise<SendResult> {
  logMailFailure(log, failure, context)
  const now = new Date()
  const message = mailFailureMessage(failure)
  const step = nextStep(failure, row.attempts, now)
  const attempt = {
    outcome: step.retry ? ('retrying' as const) : ('failed' as const),
    errorCode: failure.code,
    errorParams: failure.params,
  }
  if (step.retry) {
    const written = await writeOutcome(
      row,
      {
        status: 'queued',
        nextAttemptAt: step.nextAttemptAt,
        leaseUntil: null,
        ...errorColumns(failure),
      },
      attempt,
    )
    if (!written) return staleOutcome(row)
    await syncInvitation(row, invitationDeliveryPatch('queued', message, now))
    return {
      status: 'retrying',
      id: row.id,
      failure,
      nextAttemptAt: step.nextAttemptAt,
    }
  }
  const written = await writeOutcome(
    row,
    {
      status: 'failed',
      nextAttemptAt: null,
      leaseUntil: null,
      ...errorColumns(failure),
    },
    attempt,
  )
  if (!written) return staleOutcome(row)
  await syncInvitation(row, invitationDeliveryPatch('failed', message, now))
  return { status: 'failed', id: row.id, failure }
}

/**
 * Writes the row's new state and its attempt record in one transaction. Returns
 * false, and writes nothing, when this claim no longer owns the row.
 */
async function writeOutcome(
  row: OutboxRow,
  patch: Partial<typeof emailOutbox.$inferInsert>,
  attempt: {
    outcome: 'sent' | 'retrying' | 'failed'
    errorCode?: string
    errorParams?: Record<string, string>
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owned = await tx
      .update(emailOutbox)
      .set(patch)
      .where(ownedBy(row))
      .returning({ id: emailOutbox.id })
    if (owned.length === 0) return false
    await tx.insert(emailDeliveryAttempt).values({
      outboxId: row.id,
      attempt: row.attempts,
      outcome: attempt.outcome,
      errorCode: attempt.errorCode ?? null,
      errorParams: attempt.errorParams ?? null,
    })
    return true
  })
}

/**
 * The claim lost its lease before the outcome was written. The row now belongs
 * to a newer attempt, so this result is not recorded. Its outcome is reported
 * from the row's current state.
 */
async function staleOutcome(row: OutboxRow): Promise<SendResult> {
  log.warn('mail outcome ignored: the row was claimed again', {
    outboxId: row.id,
    attempt: row.attempts,
  })
  const [current] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, row.id))
    .limit(1)
  if (!current) throw new Error(`Email ${row.id} not found`)
  return resultOf(current)
}

/** Mirrors an invitation email's outcome onto its invitation row. */
async function syncInvitation(
  row: Pick<OutboxRow, 'kind' | 'params'>,
  patch: {
    deliveryStatus: InvitationDeliveryStatus
    lastDeliveryError: string | null
    lastSentAt?: Date
  },
) {
  const invitationId = row.params.invitationId
  if (row.kind !== 'invitation' || typeof invitationId !== 'string') return
  await db.update(invitation).set(patch).where(eq(invitation.id, invitationId))
}

function errorColumns(failure: MailFailure) {
  return {
    lastErrorCode: failure.code,
    lastErrorParams: failure.params,
    lastError: failure.detail,
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

/** The result for a row that is no longer in the sending state. */
function resultOf(row: OutboxRow): SendResult {
  if (row.status === 'sent') return { status: 'sent', id: row.id }
  const failure: MailFailure = {
    code: (row.lastErrorCode ?? 'unknown') as MailFailureCode,
    params: row.lastErrorParams ?? {},
    detail: row.lastError ?? '',
    retryable: row.status !== 'failed',
    ref: row.id,
  }
  if (row.status === 'failed') return { status: 'failed', id: row.id, failure }
  if (row.status === 'cancelled') {
    throw new Error(
      `Email ${row.id} was cancelled; only the worker sends notifications`,
    )
  }
  return {
    status: 'retrying',
    id: row.id,
    failure,
    nextAttemptAt: row.nextAttemptAt ?? new Date(),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A notification email whose recipient lost access or switched the kind off
 * since the event. Cancelled, not failed: nothing went wrong, so no alert.
 */
async function cancelUndelivered(row: OutboxRow): Promise<void> {
  const owned = await db
    .update(emailOutbox)
    .set({ status: 'cancelled', leaseUntil: null, nextAttemptAt: null })
    .where(ownedBy(row))
    .returning({ id: emailOutbox.id })
  if (owned.length === 0) return
  log.info('notification email skipped: recipient no longer eligible', {
    outboxId: row.id,
    kind: row.kind,
  })
}
