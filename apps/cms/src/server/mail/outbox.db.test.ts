/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import type * as MailConfig from '#/server/mail/config'
import type * as MailTransport from '#/server/mail/transport'

import { asc, eq, inArray, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { emailDeliveryAttempt, emailOutbox, user } from '#/db/schema'
import { env } from '#/env'
import { getBranding } from '#/server/admin/branding'

import {
  cleanupOutbox,
  enqueueEmail,
  listRecentEmails,
  processOutbox,
  sendNow,
  sendTestEmail,
} from './outbox.ts'

// `override` undefined: the environment's SMTP (Mailpit). null: not configured.
// An object: that host and port (port 1 refuses connections).
const override = vi.hoisted(() => ({
  value: undefined as undefined | null | { host: string; port: number },
}))

vi.mock('#/server/mail/config', async (importOriginal) => {
  const actual = await importOriginal<typeof MailConfig>()
  return {
    ...actual,
    isMailConfigured: async () => {
      if (override.value === undefined) return actual.isMailConfigured()
      return override.value !== null
    },
    resolveMailConfig: async () => {
      if (override.value === undefined) return actual.resolveMailConfig()
      if (override.value === null) return null
      return {
        source: 'env' as const,
        host: override.value.host,
        port: override.value.port,
        secure: 'none' as const,
        username: null,
        password: null,
        from: 'cms@areca.local',
        replyTo: null,
      }
    },
  }
})

// `onSend` runs inside a send, before the real SMTP call. Tests use it to
// simulate another claim taking over while this one is in flight.
const transport = vi.hoisted(() => ({
  onSend: undefined as undefined | (() => Promise<void>),
}))

vi.mock('#/server/mail/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof MailTransport>()
  return {
    ...actual,
    sendMail: async (...args: Parameters<typeof MailTransport.sendMail>) => {
      const hook = transport.onSend
      transport.onSend = undefined
      if (hook) await hook()
      return actual.sendMail(...args)
    },
  }
})

const hasDb = Boolean(process.env.DATABASE_URL)

// The SMTP sink the suite runs against (Mailpit in CI and in docker/compose),
// as the environment configures it.
const smtpHost = env.SMTP_HOST ?? '127.0.0.1'
const smtpPort = env.SMTP_PORT ?? 1025

beforeEach(() => {
  override.value = undefined
})

async function rowOf(id: string) {
  const [row] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, id))
    .limit(1)
  if (!row) throw new Error(`outbox row ${id} missing`)
  return row
}

function secondsFromNow(date: Date | null) {
  return date ? (date.getTime() - Date.now()) / 1000 : Number.NaN
}

/** Waits for Mailpit to receive a message to `to` and returns its details. */
async function mailpitMessage(to: string) {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:8025'
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${base}/api/v1/messages`)).json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
    }
    const hit = list.messages?.find((msg) =>
      msg.To?.some((addr) => addr.Address === to),
    )
    if (hit) {
      return (await (
        await fetch(`${base}/api/v1/message/${hit.ID}`)
      ).json()) as {
        Subject: string
        From: { Name?: string; Address: string }
        HTML: string
        Text: string
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

describe.skipIf(!hasDb)('email outbox', () => {
  it('keeps an immediate send away from the worker until its lease expires', async () => {
    const to = `immediate-${crypto.randomUUID()}@areca.local`
    const queued = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
      locale: 'en',
      immediate: true,
    })
    expect(queued.claimedAttempt).toBe(1)

    // The worker runs while the caller is about to send: it must not claim.
    expect(await processOutbox({ only: [queued.id] })).toBe(0)
    expect(await rowOf(queued.id)).toMatchObject({
      status: 'sending',
      attempts: 1,
    })

    await expect(
      sendNow(queued.id, { claimedAttempt: queued.claimedAttempt }),
    ).resolves.toEqual({ status: 'sent', id: queued.id })
    expect(await rowOf(queued.id)).toMatchObject({
      status: 'sent',
      attempts: 1,
    })
  })

  it('lets the worker take an immediate row once its lease has lapsed', async () => {
    const queued = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to: `lapsed-${crypto.randomUUID()}@areca.local`,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
      locale: 'en',
      immediate: true,
    })
    await db
      .update(emailOutbox)
      .set({ leaseUntil: new Date(Date.now() - 1000) })
      .where(eq(emailOutbox.id, queued.id))

    expect(await processOutbox({ only: [queued.id] })).toBe(1)
    expect(await rowOf(queued.id)).toMatchObject({
      status: 'sent',
      attempts: 2,
    })
  })

  it('ignores the outcome of a sender whose lease was taken over mid-send', async () => {
    const to = `fenced-${crypto.randomUUID()}@areca.local`
    const { id } = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
      locale: 'en',
    })
    transport.onSend = async () => {
      // A newer claim (attempt 2) takes the row while attempt 1 is in SMTP.
      await db
        .update(emailOutbox)
        .set({
          attempts: sql`${emailOutbox.attempts} + 1`,
          leaseUntil: new Date(Date.now() + 60_000),
        })
        .where(eq(emailOutbox.id, id))
    }

    await processOutbox({ only: [id] })

    // The stale attempt's "sent" must not overwrite the newer claim.
    expect(await rowOf(id)).toMatchObject({
      status: 'sending',
      attempts: 2,
      sentAt: null,
      providerMessageId: null,
    })
  })

  it('enqueues, sends now, and delivers a branded message visible in Mailpit', async () => {
    const brand = await getBranding()
    const to = `outbox-${crypto.randomUUID()}@areca.local`
    const { id } = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
      locale: 'nl',
    })
    expect(await rowOf(id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      subject: `Testmail van ${brand.appName}`,
    })

    await expect(sendNow(id)).resolves.toEqual({ status: 'sent', id })

    expect(await rowOf(id)).toMatchObject({
      status: 'sent',
      attempts: 1,
      lastErrorCode: null,
    })
    const sent = await rowOf(id)
    expect(sent.sentAt).toBeInstanceOf(Date)
    expect(sent.providerMessageId).toBeTruthy()

    const delivered = await mailpitMessage(to)
    expect(delivered?.Subject).toBe(`Testmail van ${brand.appName}`)
    expect(delivered?.From.Name).toBe(brand.emailFromName ?? brand.appName)
    expect(delivered?.HTML).toContain('<table')
    expect(delivered?.HTML).toContain(brand.appName)
    expect(delivered?.Text).toContain('mailpit')
  })

  it('retries with 1 and 5 minute waits, then gives up after the third attempt', async () => {
    const to = `retry-${crypto.randomUUID()}@areca.local`
    override.value = { host: 'localhost', port: 1 }
    const { id } = await enqueueEmail({
      // A live kind: test emails don't count towards mail health.
      kind: 'health-check',
      template: 'test',
      to,
      params: { host: 'localhost', sentBy: 'admin@areca.local' },
    })

    const first = await sendNow(id)
    expect(first.status).toBe('retrying')
    expect(first.status === 'retrying' && first.failure).toMatchObject({
      code: 'connection_failed',
      retryable: true,
    })
    const afterFirst = await rowOf(id)
    expect(afterFirst).toMatchObject({
      status: 'queued',
      attempts: 1,
      lastErrorCode: 'connection_failed',
      lastErrorParams: { host: 'localhost', port: '1' },
    })
    expect(secondsFromNow(afterFirst.nextAttemptAt)).toBeGreaterThan(55)
    expect(secondsFromNow(afterFirst.nextAttemptAt)).toBeLessThan(65)

    // Not due yet, so the worker leaves it alone.
    await processOutbox({ only: [id] })
    expect(await rowOf(id)).toMatchObject({ status: 'queued', attempts: 1 })

    await db
      .update(emailOutbox)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(emailOutbox.id, id))
    await processOutbox({ only: [id] })
    const afterSecond = await rowOf(id)
    expect(afterSecond).toMatchObject({ status: 'queued', attempts: 2 })
    expect(secondsFromNow(afterSecond.nextAttemptAt)).toBeGreaterThan(295)
    expect(secondsFromNow(afterSecond.nextAttemptAt)).toBeLessThan(305)

    await db
      .update(emailOutbox)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(emailOutbox.id, id))
    await processOutbox({ only: [id] })
    expect(await rowOf(id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      nextAttemptAt: null,
      lastErrorCode: 'connection_failed',
    })

    const recent = (await listRecentEmails({ status: 'failed' })).find(
      (email) => email.id === id,
    )
    expect(recent).toMatchObject({ status: 'failed', retrying: false })
    expect(recent?.error?.message).toContain(
      "Couldn't reach localhost on port 1",
    )

    // Each outcome is one attempt record: the banner counts these.
    const attempts = await db
      .select({
        attempt: emailDeliveryAttempt.attempt,
        outcome: emailDeliveryAttempt.outcome,
      })
      .from(emailDeliveryAttempt)
      .where(eq(emailDeliveryAttempt.outboxId, id))
      .orderBy(asc(emailDeliveryAttempt.attempt))
    expect(attempts).toEqual([
      { attempt: 1, outcome: 'retrying' },
      { attempt: 2, outcome: 'retrying' },
      { attempt: 3, outcome: 'failed' },
    ])
  })

  it('fails a non-retryable error (no mail configured) on the first attempt', async () => {
    override.value = null
    const { id } = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to: `none-${crypto.randomUUID()}@areca.local`,
      params: { host: 'localhost', sentBy: 'admin@areca.local' },
    })

    const result = await sendNow(id)
    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'not_configured', retryable: false },
    })
    expect(await rowOf(id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      nextAttemptAt: null,
      lastErrorCode: 'not_configured',
    })
  })

  it('reclaims a crashed send once its lease has expired', async () => {
    const to = `crashed-${crypto.randomUUID()}@areca.local`
    const { id } = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
    })
    // The process died mid-send: status stuck at 'sending' with an old lease.
    await db
      .update(emailOutbox)
      .set({
        status: 'sending',
        attempts: 1,
        leaseUntil: new Date(Date.now() - 60_000),
      })
      .where(eq(emailOutbox.id, id))

    await processOutbox({ only: [id] })

    expect(await rowOf(id)).toMatchObject({ status: 'sent', attempts: 2 })
    expect(await mailpitMessage(to)).not.toBeNull()
  })

  it('closes a crashed send that already used its last attempt', async () => {
    const { id } = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to: `exhausted-${crypto.randomUUID()}@areca.local`,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
    })
    await db
      .update(emailOutbox)
      .set({
        status: 'sending',
        attempts: 3,
        leaseUntil: new Date(Date.now() - 60_000),
      })
      .where(eq(emailOutbox.id, id))

    await processOutbox({ only: [id] })

    expect(await rowOf(id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastErrorCode: 'unknown',
    })
  })

  it('records a test send with its final status and never retries it', async () => {
    const [sender] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Mail admin',
        email: `mail-admin-${crypto.randomUUID()}@test.local`,
        emailVerified: true,
      })
      .returning()
    if (!sender) throw new Error('fixture failed')
    const to = `test-${crypto.randomUUID()}@areca.local`
    try {
      const sent = await sendTestEmail({
        draft: {
          host: smtpHost,
          port: smtpPort,
          secure: 'none',
          username: null,
          fromAddress: 'cms@areca.local',
          replyTo: null,
        },
        to,
        locale: 'tr',
        userId: sender.id,
      })
      expect(sent.status).toBe('sent')
      const sentRow = await rowOf(sent.id)
      expect(sentRow).toMatchObject({
        kind: 'test',
        status: 'sent',
        attempts: 1,
        userId: sender.id,
      })
      expect(sentRow.subject).toContain('uygulamasından test e-postası')
      expect((await mailpitMessage(to))?.Text).toContain(smtpHost)

      const failed = await sendTestEmail({
        draft: {
          host: 'localhost',
          port: 1,
          secure: 'none',
          username: null,
          fromAddress: 'cms@areca.local',
          replyTo: null,
        },
        to,
        userId: sender.id,
      })
      expect(failed).toMatchObject({
        status: 'failed',
        failure: { code: 'connection_failed', retryable: false },
      })
      expect(await rowOf(failed.id)).toMatchObject({
        kind: 'test',
        status: 'failed',
        attempts: 1,
      })

      await processOutbox({ only: [failed.id] })
      expect(await rowOf(failed.id)).toMatchObject({
        status: 'failed',
        attempts: 1,
      })
    } finally {
      await db.delete(user).where(inArray(user.id, [sender.id]))
    }
  })

  it('deletes outbox rows older than 30 days and keeps newer ones', async () => {
    const old = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to: `old-${crypto.randomUUID()}@areca.local`,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
    })
    const fresh = await enqueueEmail({
      kind: 'test',
      template: 'test',
      to: `fresh-${crypto.randomUUID()}@areca.local`,
      params: { host: 'mailpit', sentBy: 'admin@areca.local' },
    })
    await db
      .update(emailOutbox)
      .set({ createdAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(emailOutbox.id, old.id))

    expect(await cleanupOutbox()).toBeGreaterThanOrEqual(1)

    const remaining = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(inArray(emailOutbox.id, [old.id, fresh.id]))
    expect(remaining.map((row) => row.id)).toEqual([fresh.id])
  })
})
