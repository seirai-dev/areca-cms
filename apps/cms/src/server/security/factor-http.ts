import { m } from '#/paraglide/messages'
import { withFactorLock } from './factor-lock'
import {
  clearStepUpFailures,
  isStepUpLocked,
  recordStepUpFailure,
} from './step-up'

/** Apply the same account-wide budget to direct Better Auth verification. */
export async function handleLocalFactorRequest(
  request: Request,
  handle: (request: Request) => Promise<Response>,
  readSession: () => Promise<{ user: { id: string } } | null>,
) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '')
  if (
    request.method !== 'POST' ||
    !/\/two-factor\/verify-(totp|backup-code)$/.test(path)
  )
    return handle(request)
  const principal = await readSession()
  if (!principal) return handle(request) // Sign-in challenges use Better Auth's own budget.
  return withFactorLock(principal.user.id, async () => {
    if (await isStepUpLocked(principal.user.id)) {
      return Response.json(
        { message: m.server_step_up_locked() },
        { status: 403 },
      )
    }
    const response = await handle(request)
    if (response.ok) await clearStepUpFailures(principal.user.id)
    else if (response.status >= 400 && response.status < 500)
      await recordStepUpFailure(principal.user.id)
    return response
  })
}
