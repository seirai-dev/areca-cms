import { createServerFn } from '@tanstack/react-start'
import { and, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { user, verification } from '#/db/schema'
import { emailPasswordEnabled } from '#/lib/auth-providers'
import { requireAgencyAdmin, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { allowUserAction } from '#/server/http/rate-limit.server'
import {
  sendPasswordResetLink,
  sendVerificationEmail,
} from '#/server/mail/account-emails'
import { resolveMailConfig } from '#/server/mail/config'
import { mailFailureMessage } from '#/server/mail/errors'
import { MAIL_LOCALES } from '#/server/mail/render/types'
import type { MailFailure } from '#/server/mail/types'

const accountFn = { strict: { output: false } as const }

/** A verification email per user per hour, so the button cannot be used to spam. */
const VERIFY_REQUEST_RULE = { limit: 3, windowSeconds: 60 * 60 }

/** Mail isn't configured: nothing was attempted, so there is no failure record. */
const NOT_CONFIGURED: Pick<MailFailure, 'code' | 'params'> = {
  code: 'not_configured',
  params: {},
}

/** Public: the login and forgot-password pages use it to show or hide the reset link. */
export const getPasswordResetAvailabilityFn = createServerFn({
  method: 'GET',
  ...accountFn,
}).handler(async () => {
  if (!emailPasswordEnabled) {
    return { available: false, reason: 'password_sign_in_disabled' as const }
  }
  if (!(await resolveMailConfig())) {
    return { available: false, reason: 'mail_not_configured' as const }
  }
  return { available: true, reason: 'ok' as const }
})

/**
 * Public: lets the reset page say up front that a link expired or was used,
 * instead of after the person typed a new password. Tokens are 24 random
 * characters, so answering valid/invalid does not help guessing them.
 */
export const checkPasswordResetTokenFn = createServerFn({
  method: 'GET',
  ...accountFn,
})
  .validator(z.object({ token: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ id: verification.id })
      .from(verification)
      .where(
        and(
          eq(verification.identifier, `reset-password:${data.token}`),
          gt(verification.expiresAt, new Date()),
        ),
      )
      .limit(1)
    return { valid: Boolean(row) }
  })

/** Sends the verification email to the caller. Already verified → ok, nothing sent. */
export const requestVerificationEmailFn = createServerFn({
  method: 'POST',
  ...accountFn,
}).handler(async () => {
  const session = await requireUser()
  if (session.user.emailVerified) return { ok: true as const }
  if (
    !(await allowUserAction(
      'verify-email-request',
      session.user.id,
      VERIFY_REQUEST_RULE,
    ))
  ) {
    return {
      ok: false as const,
      message: m.server_verification_email_rate_limited(),
    }
  }
  if (!(await resolveMailConfig())) {
    return { ok: false as const, message: mailFailureMessage(NOT_CONFIGURED) }
  }
  const result = await sendVerificationEmail(session.user.id)
  // Null here means the account was verified in the meantime.
  if (!result) return { ok: true as const }
  if (result.status === 'failed') {
    return { ok: false as const, message: mailFailureMessage(result.failure) }
  }
  return { ok: true as const }
})

/** Sets the language account and notification emails use. */
export const updateEmailLocaleFn = createServerFn({
  method: 'POST',
  ...accountFn,
})
  .validator(z.object({ locale: z.enum(MAIL_LOCALES) }))
  .handler(async ({ data }) => {
    const session = await requireUser()
    await db
      .update(user)
      .set({ locale: data.locale })
      .where(eq(user.id, session.user.id))
    return { locale: data.locale }
  })

/**
 * Agency admin: sends a reset link (or the provider pointer for SSO-only
 * accounts) to a person. The result says which one was sent.
 */
export const sendPasswordResetLinkFn = createServerFn({
  method: 'POST',
  ...accountFn,
})
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    const outcome = await sendPasswordResetLink(data.userId, session.user.id)
    if (!outcome) {
      return {
        ok: false as const,
        message: mailFailureMessage(NOT_CONFIGURED),
      }
    }
    const { sso, result } = outcome
    if (result.status === 'failed') {
      return {
        ok: false as const,
        message: mailFailureMessage(result.failure),
        ref: result.failure.ref,
      }
    }
    if (sso) return { ok: true as const, status: 'sso' as const }
    return {
      ok: true as const,
      status:
        result.status === 'sent' ? ('sent' as const) : ('queued' as const),
    }
  })
