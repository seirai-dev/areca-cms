import { contentSecurityPolicyHeader } from './csp'
import type { CspOptions } from './csp'

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
]

export function withSecurityHeaders(
  request: Request,
  response: Response,
  csp: CspOptions,
) {
  const headers = new Headers(response.headers)
  for (const [name, value] of [
    ...SECURITY_HEADERS,
    contentSecurityPolicyHeader(csp),
  ]) {
    if (!headers.has(name)) headers.set(name, value)
  }
  if (new URL(request.url).protocol === 'https:') {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
