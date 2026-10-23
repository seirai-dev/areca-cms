import { createServerFn } from '@tanstack/react-start'
import { z } from '#/lib/zod'

import {
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { allowUserAction } from '#/server/http/rate-limit.server'
import { mailFailureMessage } from '#/server/mail/errors'
import {
  getMailHealth,
  listRecentEmails,
  sendTestEmail,
} from '#/server/mail/outbox'
import {
  getMailSettingsStatus,
  saveMailSettings,
  useEnvironmentMail,
  verifyMailDraft,
} from '#/server/mail/settings'
import type { MailFailure } from '#/server/mail/types'

const mailFn = { strict: { output: false } as const }

/** Handshakes are cheap but still open sockets to a third-party server. */
const VERIFY_RULE = { limit: 20, windowSeconds: 10 * 60 }
/** A test email is a real send; keep it tighter than verify. */
const TEST_RULE = { limit: 10, windowSeconds: 10 * 60 }
const LIST_LIMIT = 50

const mailDraftSchema = z.object({
  host: z.string().max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.enum(['starttls', 'tls', 'none']),
  username: z.string().max(320).nullable(),
  password: z.string().max(1000).optional(),
  clearPassword: z.boolean().optional(),
  fromAddress: z.string().max(320),
  replyTo: z.string().max(320).nullable(),
})

/** Readable for the admin; `detail` is the redacted technical line. */
function failureResult(failure: MailFailure) {
  return {
    code: failure.code,
    message: mailFailureMessage(failure),
    ref: failure.ref,
    detail: failure.detail,
  }
}

export const getMailSettingsFn = createServerFn({
  method: 'GET',
  ...mailFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return getMailSettingsStatus()
})

/** Handshake and login on the unsaved form values. Sends nothing. */
export const verifyMailDraftFn = createServerFn({ method: 'POST', ...mailFn })
  .validator(mailDraftSchema)
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    if (!(await allowUserAction('mail-verify', session.user.id, VERIFY_RULE))) {
      throw new Error(m.agency_mail_error_rate_limited())
    }
    const result = await verifyMailDraft(data)
    if (result.ok) return { ok: true as const }
    return { ok: false as const, error: failureResult(result.failure) }
  })

/** Sends the test template to the signed-in admin, using the unsaved values. */
export const sendTestEmailFn = createServerFn({ method: 'POST', ...mailFn })
  .validator(mailDraftSchema)
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    if (!(await allowUserAction('mail-test', session.user.id, TEST_RULE))) {
      throw new Error(m.agency_mail_error_rate_limited())
    }
    const to = session.user.email
    const result = await sendTestEmail({
      draft: data,
      to,
      locale: getLocale(),
      userId: session.user.id,
    })
    if (result.status === 'sent') return { ok: true as const, to }
    return { ok: false as const, to, error: failureResult(result.failure) }
  })

/**
 * Saves the Mail tab settings. The server runs the verification itself: a
 * failed check blocks the save unless the admin chose `force` ("Save anyway").
 * The client never tells the server whether the values were verified.
 */
export const saveMailSettingsFn = createServerFn({ method: 'POST', ...mailFn })
  .validator(mailDraftSchema.extend({ force: z.boolean() }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    const { force, ...draft } = data
    const result = await verifyMailDraft(draft)
    if (!result.ok && !force) {
      return {
        ok: false as const,
        error: failureResult(result.failure),
      }
    }
    const status = await saveMailSettings(
      { ...draft, verified: result.ok },
      session.user.id,
    )
    return { ok: true as const, status, verified: result.ok }
  })

/** Switches sending to the environment variables. Stored values are kept. */
export const useEnvironmentMailFn = createServerFn({
  method: 'POST',
  ...mailFn,
}).handler(async () => {
  const session = await requireFreshAgencyAdmin()
  return useEnvironmentMail(session.user.id)
})

export const listRecentEmailsFn = createServerFn({
  method: 'GET',
  ...mailFn,
})
  .validator(z.object({ status: z.literal('failed').optional() }).optional())
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return listRecentEmails({ limit: LIST_LIMIT, status: data?.status })
  })

/** Failure streak for the shell banner, plus the source ("not set up" when none). */
export const getMailHealthFn = createServerFn({
  method: 'GET',
  ...mailFn,
}).handler(async () => {
  await requireAgencyAdmin()
  const [health, status] = await Promise.all([
    getMailHealth(),
    getMailSettingsStatus(),
  ])
  return { ...health, source: status.source }
})
