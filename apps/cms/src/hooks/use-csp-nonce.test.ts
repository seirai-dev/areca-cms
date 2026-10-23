import { describe, expect, it } from 'vitest'

import { publishLibraryNonce } from './use-csp-nonce'

describe('publishLibraryNonce', () => {
  it('publishes the page nonce for libraries that read the webpack global', () => {
    const scope: { __webpack_nonce__?: string } = {}
    publishLibraryNonce(scope, 'page-nonce')
    expect(scope.__webpack_nonce__).toBe('page-nonce')
  })

  it('writes nothing without a nonce, so no request nonce is shared', () => {
    const scope: { __webpack_nonce__?: string } = {}
    publishLibraryNonce(scope, undefined)
    expect(scope).toEqual({})
  })

  it('reads nothing on the server, where there is no document', () => {
    const scope: { __webpack_nonce__?: string } = {}
    publishLibraryNonce(scope)
    expect(scope).toEqual({})
  })
})
