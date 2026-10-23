/**
 * Strict policy observed in browser reports but not enforced yet. TanStack
 * Start still emits inline hydration scripts, which `script-src 'self'` would
 * block. Move to enforcement once those carry a nonce (router `ssr.nonce`, see
 * server.ts) or the scripts are moved to files. Assets are served from this
 * origin (/api/assets/file), so no storage origin is listed.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  [
    'Content-Security-Policy',
    "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  ],
  ['Content-Security-Policy-Report-Only', CSP_REPORT_ONLY],
]

export function withSecurityHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers)
  for (const [name, value] of SECURITY_HEADERS) {
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
