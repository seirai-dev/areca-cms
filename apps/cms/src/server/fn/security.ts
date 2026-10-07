import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'

import { requireUser } from '#/lib/session.server'
import { ForbiddenError } from '#/server/content/errors'
import { m } from '#/paraglide/messages'
import { verifyStepUp } from '#/server/security/verify-step-up'

const securityFn = { strict: { output: false } as const }

/** Re-enter a TOTP code to unlock a `REAUTH_REQUIRED` action for ten minutes. */
export const verifyStepUpFn = createServerFn({
  method: 'POST',
  ...securityFn,
})
  .validator(z.object({ code: z.string().min(6).max(12) }))
  .handler(async ({ data }) => {
    const session = await requireUser()
    if (!session.user.twoFactorEnabled) {
      throw new ForbiddenError(m.server_step_up_no_two_factor())
    }
    return verifyStepUp({
      session: session.session,
      userId: session.user.id,
      code: data.code,
      headers: getRequestHeaders(),
    })
  })
