import { useRouter } from '@tanstack/react-router'

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

function readNonceFromDocument(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[property="csp-nonce"]',
  )
  return meta?.content || undefined
}
