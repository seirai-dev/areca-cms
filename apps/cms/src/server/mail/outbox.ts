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
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm'

import { db } from '#/db'
import { emailOutbox, invitation, mailSettings, user } from '#/db/schema'
import { getBranding } from '#/server/admin/branding'
import { createLogger } from '#/server/log'

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
  healthWindowStart,
  invitationDeliveryPatch,
  nextStep,
} from './outbox-policy.ts'
import type { InvitationDeliveryStatus } from './outbox-policy.ts'
import { mailLocale, MailRenderError, renderTemplate } from './render/index.ts'
import type { Executor, MailLocale } from './render/index.ts'
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
  | 'notification'

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed'

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
}

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
const BATCH_SIZE = 20
/** 5 sends per second. */
const SEND_INTERVAL_MS = 200
const RECENT_LIMIT = 50
const RECENT_LIMIT_MAX = 200

/** Inserts a queued row. Pass a transaction to enqueue atomically. */
export async function enqueueEmail(
  input: EnqueueEmailInput,
  connection?: unknown,
): Promise<{ id: string }> {
  const executor = (connection ?? db) as Executor
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
      status: 'queued',
      attempts: 0,
      nextAttemptAt: new Date(),
    })
    .returning({ id: emailOutbox.id })
  if (!row) throw new Error('Failed to queue email')
  return { id: row.id }
}

/** The subject is stored for the log. A render problem must not block queuing. */
async function renderSubject(
  input: EnqueueEmailInput,
  locale: MailLocale,
  connection: Executor,
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
 * Claims the row and tries to send it now (attempt 1 for user actions).
 * `renderParams` are merged over the stored params for this attempt only.
 */
export async function sendNow(
  id: string,
  opts: { renderParams?: Record<string, unknown> } = {},
): Promise<SendResult> {
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

  // Already sent, being sent by the worker, or failed: report that state.
  const [current] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, id))
    .limit(1)
  if (!current) throw new Error(`Email ${id} not found`)
  return resultOf(current)
}

/** One worker tick: claim due rows (SKIP LOCKED), send paced at 5/s. */
export async function processOutbox(
  /** Tests only: limit the tick to these rows (the table is shared). */
  opts: { only?: readonly string[] } = {},
): Promise<number> {
  await failExhaustedRows()
  const rows = await claimDueRows(opts.only)
  for (const [index, row] of rows.entries()) {
    if (index > 0) await sleep(SEND_INTERVAL_MS)
    try {
      await sendClaimed(row)
    } catch (error) {
      // The row keeps its lease and is reclaimed once the lease expires.
      log.error('outbox row could not be recorded', {
        outboxId: row.id,
        err: error,
      })
    }
  }
  return rows.length
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
  // (a new server deserves a fresh start). `createdAt` stands in for the
  // attempt time because the outbox has no updated column.
  const since = healthWindowStart(
    latest?.sentAt ?? null,
    settings?.updatedAt ?? null,
  )
  const failing = and(
    live,
    isNotNull(emailOutbox.lastErrorCode),
    or(eq(emailOutbox.status, 'queued'), eq(emailOutbox.status, 'failed')),
    gt(emailOutbox.createdAt, since),
  )
  const [counted] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(failing)
  const consecutiveFailures = counted?.value ?? 0
  const [last] = await db
    .select()
    .from(emailOutbox)
    .where(failing)
    .orderBy(desc(emailOutbox.createdAt))
    .limit(1)
  return {
    consecutiveFailures,
    lastFailureAt: last?.createdAt ?? null,
    lastFailure: last ? errorOf(last) : null,
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
  connection?: unknown,
): Promise<void> {
  const executor = (connection ?? db) as Executor
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

/** Claims due rows in one statement; `SKIP LOCKED` keeps replicas apart. */
async function claimDueRows(only?: readonly string[]): Promise<OutboxRow[]> {
  const scope = only
    ? sql`AND id IN (${sql.join(
        only.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``
  const claimed = await db.execute<{ id: string }>(sql`
    WITH due AS (
      SELECT id FROM email_outbox
      WHERE ((status = 'queued' AND next_attempt_at <= now())
        OR (status = 'sending' AND lease_until < now() AND attempts < ${MAIL_MAX_ATTEMPTS}))
        ${scope}
      ORDER BY coalesce(next_attempt_at, created_at)
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_outbox
    SET status = 'sending',
        lease_until = now() + (${LEASE_MS} * interval '1 millisecond'),
        attempts = attempts + 1
    WHERE id IN (SELECT id FROM due)
    RETURNING id
  `)
  if (claimed.rows.length === 0) return []
  return db
    .select()
    .from(emailOutbox)
    .where(
      inArray(
        emailOutbox.id,
        claimed.rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(emailOutbox.createdAt))
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

async function recordSent(row: OutboxRow, providerMessageId: string) {
  const now = new Date()
  await db
    .update(emailOutbox)
    .set({
      status: 'sent',
      sentAt: now,
      providerMessageId,
      leaseUntil: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorParams: null,
      lastError: null,
    })
    .where(eq(emailOutbox.id, row.id))
  await syncInvitation(row, invitationDeliveryPatch('sent', null, now))
  return { status: 'sent', id: row.id } satisfies SendResult
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
  if (step.retry) {
    await db
      .update(emailOutbox)
      .set({
        status: 'queued',
        nextAttemptAt: step.nextAttemptAt,
        leaseUntil: null,
        ...errorColumns(failure),
      })
      .where(eq(emailOutbox.id, row.id))
    await syncInvitation(row, invitationDeliveryPatch('queued', message, now))
    return {
      status: 'retrying',
      id: row.id,
      failure,
      nextAttemptAt: step.nextAttemptAt,
    }
  }
  await db
    .update(emailOutbox)
    .set({
      status: 'failed',
      nextAttemptAt: null,
      leaseUntil: null,
      ...errorColumns(failure),
    })
    .where(eq(emailOutbox.id, row.id))
  await syncInvitation(row, invitationDeliveryPatch('failed', message, now))
  return { status: 'failed', id: row.id, failure }
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
