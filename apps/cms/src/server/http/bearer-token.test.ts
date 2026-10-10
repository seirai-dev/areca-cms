import { describe, expect, it } from 'vitest'

import { authorizationToken, bearerToken } from './bearer-token'

describe('bearerToken', () => {
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])('accepts %s', (scheme) => {
    expect(
      bearerToken(
        new Request('https://cms.test', {
          headers: { authorization: `${scheme}   opaque-token` },
        }),
      ),
    ).toBe('opaque-token')
  })

  it('counts DPoP credentials without treating them as Bearer', () => {
    const request = new Request('https://cms.test', {
      headers: { authorization: 'dPoP opaque-token' },
    })
    expect(authorizationToken(request)).toBe('opaque-token')
    expect(bearerToken(request)).toBeNull()
  })

  it.each([
    'Bearer',
    'Bearer ',
    'Basic token',
    'Bearer token extra',
    'Bearer\ttoken',
  ])('refuses malformed credentials %s', (header) => {
    expect(
      bearerToken(
        new Request('https://cms.test', {
          headers: { authorization: header },
        }),
      ),
    ).toBeNull()
  })
})
