/**
 * Content-Security-Policy for the CMS document and its API responses.
 *
 * Scripts and `<style>` elements may run only with the per-request nonce. The
 * router stamps that nonce on every element it emits (hydration and body
 * scripts, head styles, the streaming scripts React writes), see
 * `getRouter` in router.tsx. Libraries that write their own inline elements get
 * the nonce passed in (next-themes, see `useCspNonce`), except Sonner, whose
 * stylesheet is allowed by hash (see SONNER_STYLE_HASH). Inline `style`
 * attributes stay allowed because React renders them for layout and view
 * transitions; they cannot run script.
 *
 * Two outside origins are listed because the branding screen loads Google Fonts
 * stylesheets for its font previews. Assets are served from this origin
 * (/api/assets/file), so no storage origin is listed.
 */

const GOOGLE_STYLESHEET_ORIGIN = 'https://fonts.googleapis.com'
const GOOGLE_FONT_ORIGIN = 'https://fonts.gstatic.com'

/**
 * The stylesheet Sonner (the toast library) injects into `<head>` when its
 * module loads. The library gives no way to set a nonce, so the stylesheet is
 * allowed by its hash instead. It is fixed text in the pinned package, and
 * csp.test.ts fails when an upgrade changes it, so the hash is updated then.
 */
export const SONNER_STYLE_HASH =
  "'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='"

/**
 * Sonner appends its `<style>` empty and fills it in straight after, so the
 * browser checks the empty element too. This is the hash of the empty string.
 */
const EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"

/** Directives that do not depend on the mode. */
const SHARED_DIRECTIVES = [
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]

/**
 * The policy for a production response. `nonce` is this request's nonce and
 * must be the one the router was given.
 */
export function productionCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}' ${EMPTY_STYLE_HASH} ${SONNER_STYLE_HASH} ${GOOGLE_STYLESHEET_ORIGIN}`,
    "style-src-attr 'unsafe-inline'",
    `font-src 'self' data: ${GOOGLE_FONT_ORIGIN}`,
    "connect-src 'self'",
    ...SHARED_DIRECTIVES,
  ].join('; ')
}

/**
 * The relaxed policy for the Vite dev server. It injects inline scripts for
 * React refresh and talks to HMR over a websocket. Only `vite dev` sends it,
 * never a production build.
 */
export function developmentCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    `style-src 'self' 'unsafe-inline' ${GOOGLE_STYLESHEET_ORIGIN}`,
    `font-src 'self' data: ${GOOGLE_FONT_ORIGIN}`,
    "connect-src 'self' ws: wss:",
    ...SHARED_DIRECTIVES,
  ].join('; ')
}

export interface CspOptions {
  /** This request's nonce. */
  nonce: string
  /** Send the production policy as Report-Only: violations are reported, not blocked. */
  reportOnly: boolean
  /** True under `vite dev`, where the relaxed policy applies. */
  development: boolean
}

/** The header name and value to send for a response. */
export function contentSecurityPolicyHeader(
  options: CspOptions,
): readonly [string, string] {
  if (options.development) {
    return ['Content-Security-Policy', developmentCsp()]
  }
  const name = options.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy'
  return [name, productionCsp(options.nonce)]
}
