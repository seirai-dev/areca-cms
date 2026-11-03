import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { z } from '#/lib/zod'

import { db } from '#/db'
import { account, user, verification } from '#/db/schema'
import { auth } from '#/lib/auth'
import { emailPasswordEnabled } from '#/lib/auth-providers'
import {
  forgetSession,
  requireAccountUser,
  requireAgencyAdmin,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import {
  listOwnSessions,
  revocableOwnSessionToken,
} from '#/server/auth/own-sessions'
import { allowUserAction } from '#/server/http/rate-limit.server'
import { ForbiddenError, ConflictError } from '#/server/content/errors'
import { LastAgencyAdminError } from '#/server/admin/members'
import { verifySelfDeletion } from '#/server/admin/self-delete-verification'
import {
  PERSON_NAME_MAX_LENGTH,
  deleteOwnAccount,
  renameUser,
  selfDeleteBlockers,
} from '#/server/admin/users'
import { verificationIdentifierForms } from '#/server/security/verification-identifiers'
import {
  sendPasswordResetLink,
  sendVerificationEmail,
} from '#/server/mail/account-emails'
import { isMailConfigured } from '#/server/mail/config'
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
  if (!(await isMailConfigured())) {
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
          inArray(
            verification.identifier,
            verificationIdentifierForms(`reset-password:${data.token}`),
          ),
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
  if (!(await isMailConfigured())) {
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

/**
 * The caller's live sessions for the Sessions page. Tokens never leave the
 * server; each session is named by its id.
 */
export const listMySessionsFn = createServerFn({
  method: 'GET',
  ...accountFn,
}).handler(async () => {
  const session = await requireAccountUser()
  return listOwnSessions(session.user.id, session.session.id)
})

/**
 * Signs out one of the caller's other sessions. The current session ends
 * through sign-out instead. Better Auth deletes the row, and its hook writes
 * the `session.revoke` audit entry. No cookie cache or secondary storage is
 * configured, so the revoked session stops working at once.
 */
export const revokeMySessionFn = createServerFn({
  method: 'POST',
  ...accountFn,
})
  .validator(z.object({ sessionId: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const session = await requireAccountUser()
    const token = await revocableOwnSessionToken(
      session.user.id,
      session.session.id,
      data.sessionId,
    )
    await auth.api.revokeSession({
      body: { token },
      headers: getRequestHeaders(),
    })
    forgetSession()
    return { ok: true as const }
  })

/**
 * Signs out every other session of the caller. The current session stays.
 * Audited by Better Auth's hook as `session.revoke_others`.
 */
export const revokeMyOtherSessionsFn = createServerFn({
  method: 'POST',
  ...accountFn,
}).handler(async () => {
  await requireAccountUser()
  await auth.api.revokeOtherSessions({ headers: getRequestHeaders() })
  forgetSession()
  return { ok: true as const }
})

/**
 * What the account page needs before it renders the self-service sections:
 * whether the caller signs in with a password (only those accounts can change
 * one), and what would stop the account being deleted. Nothing secret leaves
 * the server: the hash is read for a yes/no only.
 */
export const getMyAccountFn = createServerFn({
  method: 'GET',
  ...accountFn,
}).handler(async () => {
  const session = await requireAccountUser()
  const { id } = session.user
  const credentials = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, id), eq(account.providerId, 'credential')))
  const blockers = await selfDeleteBlockers(id)
  return {
    hasPassword: credentials.some((row) => Boolean(row.password)),
    deletion: {
      soleOwnerOf: blockers.soleOwnerClients,
      lastAdmin: blockers.lastAdmin,
    },
  }
})

/** Self: the display name everyone sees. No email; the change is audited. */
export const updateMyNameFn = createServerFn({
  method: 'POST',
  ...accountFn,
})
  .validator(
    z.object({ name: z.string().trim().min(1).max(PERSON_NAME_MAX_LENGTH) }),
  )
  .handler(async ({ data }) => {
    const session = await requireAccountUser()
    await renameUser({
      actorId: session.user.id,
      userId: session.user.id,
      name: data.name,
    })
    return { ok: true as const }
  })

/**
 * Deleting an account is re-verified on the server: the password when the
 * account has one, otherwise a second-factor code when two-factor is on, and
 * the typed email in every case.
 */
export const deleteMyAccountFn = createServerFn({
  method: 'POST',
  ...accountFn,
})
  .validator(
    z.object({
      confirmEmail: z.string().trim().min(1).max(320),
      password: z.string().min(1).max(256).optional(),
      code: z.string().min(6).max(32).optional(),
      kind: z.enum(['totp', 'backup']).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAccountUser()
    const { id, email } = session.user
    if (data.confirmEmail.toLowerCase() !== email.toLowerCase()) {
      throw new ForbiddenError(m.server_self_delete_email_mismatch())
    }
    // Refusals first, so nobody types a password for an account that cannot go.
    const blockers = await selfDeleteBlockers(id)
    if (blockers.soleOwnerOf.length > 0) {
      throw new ConflictError(
        m.server_self_delete_sole_owner({
          clients: blockers.soleOwnerOf.join(', '),
        }),
      )
    }
    if (blockers.lastAdmin) throw new LastAgencyAdminError()

    await verifySelfDeletion({
      userId: id,
      twoFactorEnabled: session.user.twoFactorEnabled,
      session: session.session,
      password: data.password,
      code: data.code,
      kind: data.kind,
      headers: getRequestHeaders(),
    })

    await deleteOwnAccount({ userId: id })
    forgetSession()
    return { ok: true as const }
  })
