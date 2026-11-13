import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from '#/lib/zod'

import { requireFreshAgencyAdmin, requireSignedIn } from '#/lib/session.server'
import { ForbiddenError } from '#/server/content/errors'
import { m } from '#/paraglide/messages'
import { resetAdminFactorLockout } from '#/server/security/reset-factor-lockout'
import { verifyStepUp } from '#/server/security/verify-step-up'

const securityFn = { strict: { output: false } as const }

/** Re-enter a TOTP code to unlock a `REAUTH_REQUIRED` action for ten minutes. */
export const verifyStepUpFn = createServerFn({
  method: 'POST',
  ...securityFn,
})
  .validator(
    z.object({
      code: z.string().min(6).max(32),
      kind: z.enum(['totp', 'backup']).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireSignedIn()
    if (!session.user.twoFactorEnabled) {
      throw new ForbiddenError(m.server_step_up_no_two_factor())
    }
    return verifyStepUp({
      session: session.session,
      userId: session.user.id,
      code: data.code,
      kind: data.kind,
      headers: getRequestHeaders(),
    })
  })

/** A verified agency admin can clear another admin's failed-code lockout. */
export const resetAdminFactorLockoutFn = createServerFn({
  method: 'POST',
  ...securityFn,
})
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const principal = await requireFreshAgencyAdmin()
    await resetAdminFactorLockout(data.userId, principal.user.id)
    return { ok: true as const }
  })
