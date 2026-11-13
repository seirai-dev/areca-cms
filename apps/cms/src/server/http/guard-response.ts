import { isRedirect } from '@tanstack/react-router'

import { securityErrorCode } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'

/**
 * The HTTP answer of an API route to a refusal from the session guards
 * (`requireAgencyAdmin`, `requireOrgMember`...): no session → 401, a thrown
 * `Response` as it is, a missing second factor or stale step-up → 403 with
 * its code. Null for any other error, which the route handles or rethrows.
 */
export function guardErrorResponse(
  error: unknown,
  headers?: HeadersInit,
): Response | null {
  if (isRedirect(error)) {
    return new Response(m.server_unauthorized(), { status: 401, headers })
  }
  if (error instanceof Response) return error
  const code = securityErrorCode(error)
  if (code) return new Response(code, { status: 403, headers })
  return null
}
