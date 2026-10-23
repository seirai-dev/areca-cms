/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { sql } from 'drizzle-orm'

import { db } from '#/db'
import { account, user } from '#/db/schema'
import { env } from '#/env'
import { auth } from '#/lib/auth'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { audit } from '#/server/audit'
import { ConflictError, ForbiddenError } from '#/server/content/errors'
import { createLogger } from '#/server/log'
import { sendVerificationEmail } from '#/server/mail/account-emails'
import { mailLocale } from '#/server/mail/render/types'
import type { MailLocale } from '#/server/mail/render/types'

import {
  resetGeneratedSetupToken,
  resolveSetupToken,
  setupTokenMatches,
} from './setup-token.ts'

const SETUP_LOCK_KEY = 87236401

const log = createLogger('setup')

async function hasUsers() {
  const [row] = await db.select({ id: user.id }).from(user).limit(1)
  return Boolean(row)
}

export async function getSetupStatus() {
  const needsSetup = !(await hasUsers())
  // Every page load asks, so a fresh instance prints its token on first visit.
  resolveSetupToken(env.SETUP_TOKEN, needsSetup)
  return { needsSetup }
}

export async function completeSetup(input: {
  name: string
  email: string
  password: string
  setupToken?: string
  /** The language the setup was done in. Falls back to the request's. */
  locale?: MailLocale
}) {
  // Checked before anything else, with one generic error, so a caller without
  // the token learns nothing about whether the instance is already set up.
  const expected = resolveSetupToken(env.SETUP_TOKEN, !(await hasUsers()))
  if (!setupTokenMatches(input.setupToken, expected)) {
    throw new ForbiddenError(m.server_setup_token_invalid())
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`)

    const [existing] = await tx.select({ id: user.id }).from(user).limit(1)
    if (existing) {
      throw new ConflictError(m.server_setup_already_completed())
    }

    // Bootstrap owns every write, including the credential. Better Auth's
    // global adapter would commit independently of this transaction.
    const authContext = await auth.$context
    const id = crypto.randomUUID()
    const password = await authContext.password.hash(input.password)
    const [updated] = await tx
      .insert(user)
      .values({
        id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        emailVerified: false,
        isAgencyAdmin: true,
        // Stored now so the verification email goes out in this language.
        locale: mailLocale(input.locale ?? getLocale()),
      })
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        isAgencyAdmin: user.isAgencyAdmin,
      })
    if (!updated) throw new Error(m.server_failed_to_create_user())
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      providerId: 'credential',
      accountId: id,
      password,
    })

    await audit(
      {
        organizationId: null,
        actorId: updated.id,
        action: 'setup.completed',
        targetType: 'user',
        targetId: updated.id,
        meta: { email: updated.email },
      },
      tx,
    )
    return updated
  })
  resetGeneratedSetupToken()
  // Mail is optional at setup, so it never delays or fails the response.
  void sendVerificationEmail(result.id).catch((error: unknown) => {
    log.error('verification email could not be sent', { err: error })
  })
  return result
}
