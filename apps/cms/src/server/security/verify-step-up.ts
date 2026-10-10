import { withFactorLock } from './factor-lock'
import { auth } from '#/lib/auth'
import { m } from '#/paraglide/messages'
import { ForbiddenError } from '#/server/content/errors'
import {
  clearStepUpFailures,
  isStepUpLocked,
  recordStepUp,
  recordStepUpFailure,
} from '#/server/security/step-up'

/**
 * Re-verify the signed-in user's TOTP code (through Better Auth) and, on
 * success, mark the session fresh so the step-up gate lets sensitive actions
 * through for the next ten minutes. Wrong codes are counted so a stolen
 * session cannot be used to guess its way past the gate.
 */
export async function verifyStepUp(input: {
  session: { id: string }
  userId: string
  code: string
  kind?: 'totp' | 'backup'
  headers: Headers
}) {
  return withFactorLock(input.userId, async () => {
    if (await isStepUpLocked(input.userId)) {
      throw new ForbiddenError(m.server_step_up_locked())
    }
    try {
      if (input.kind === 'backup') {
        await auth.api.verifyBackupCode({
          headers: input.headers,
          body: { code: input.code.trim() },
        })
      } else {
        await auth.api.verifyTOTP({
          headers: input.headers,
          body: { code: input.code.replace(/\s+/g, '') },
        })
      }
    } catch {
      await recordStepUpFailure(input.userId)
      throw new ForbiddenError(m.server_step_up_invalid_code())
    }
    await clearStepUpFailures(input.userId)
    await recordStepUp(input.session.id, input.userId)
    return { ok: true as const }
  })
}
