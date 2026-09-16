import { describe, expect, it } from 'vitest'

import { validateCookieMutationOrigin } from './request-origin.ts'

describe('validateCookieMutationOrigin', () => {
  it('rejects cross-origin cookie-authenticated mutations', () => {
    const response = validateCookieMutationOrigin(
      new Request('https://cms.example.test/_server/update', {
        method: 'POST',
        headers: {
          cookie: 'session=test',
          host: 'cms.example.test',
          origin: 'https://attacker.example',
        },
      }),
    )

    expect(response?.status).toBe(403)
  })

  it('allows same-origin cookie mutations and bearer API calls', () => {
    const sameOrigin = new Request('https://cms.example.test/_server/update', {
      method: 'POST',
      headers: {
        cookie: 'session=test',
        host: 'cms.example.test',
        origin: 'https://cms.example.test',
      },
    })
    const bearer = new Request('https://cms.example.test/api/sites/manifest', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    })

    expect(validateCookieMutationOrigin(sameOrigin)).toBeNull()
    expect(validateCookieMutationOrigin(bearer)).toBeNull()
  })

  it('leaves Better Auth origin handling untouched', () => {
    const request = new Request('https://cms.example.test/api/auth/sign-in', {
      method: 'POST',
      headers: { cookie: 'session=test' },
    })

    expect(validateCookieMutationOrigin(request)).toBeNull()
  })
})
