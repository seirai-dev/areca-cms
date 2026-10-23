import { useRouter } from '@tanstack/react-router'

declare global {
  // Read by get-nonce, which react-style-singleton uses (see publishLibraryNonce).
  var __webpack_nonce__: string | undefined
}

/**
 * The Content-Security-Policy nonce of the page: this request's nonce on the
 * server, and in the browser the router's copy, falling back to the
 * `csp-nonce` meta tag the server emits. Pass it to any library that writes its
 * own inline script or style, so the element is allowed under the policy.
 */
export function useCspNonce(): string | undefined {
  const routerNonce = useRouter().options.ssr?.nonce
  return routerNonce ?? readNonceFromDocument()
}

/**
 * Radix's scroll lock (react-style-singleton, through get-nonce) writes a
 * `<style>` element when a dialog or sheet opens. It takes the nonce from the
 * `__webpack_nonce__` global, which nothing else sets, so the element is blocked
 * unless the global holds the page nonce. Call once in the browser, before any
 * dialog can open. Without a nonce (the server, or a page with no meta tag)
 * nothing is written, so one request's nonce never reaches another.
 */
export function publishLibraryNonce(
  scope: { __webpack_nonce__?: string } = globalThis,
  nonce: string | undefined = readNonceFromDocument(),
): void {
  if (nonce) scope.__webpack_nonce__ = nonce
}

function readNonceFromDocument(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[property="csp-nonce"]',
  )
  return meta?.content || undefined
}
