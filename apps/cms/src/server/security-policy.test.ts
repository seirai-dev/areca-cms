import { describe, expect, it } from 'vitest'

import { assertAgencyAdminCanBeRemoved } from '#/server/admin/agency-admin-roster'
import {
  MAX_PAGE_OFFSET,
  MAX_PAGE_SIZE,
  pageLimitSchema,
  pageOffsetSchema,
} from '#/server/pagination'
import { validateCookieMutationOrigin } from '#/server/request-origin'

function mutationRequest(
  origin?: string,
  headers: Record<string, string> = {},
) {
  return new Request('https://cms.example.test/_server/action', {
    method: 'POST',
    headers: {
      cookie: 'session=valid',
      host: 'cms.example.test',
      ...(origin ? { origin } : {}),
      ...headers,
    },
  })
}

describe('security policy', () => {
  it('rejects removing the final agency admin', () => {
    expect(() => assertAgencyAdminCanBeRemoved(1)).toThrow(
      'Cannot remove the last agency admin',
    )
    expect(() => assertAgencyAdminCanBeRemoved(2)).not.toThrow()
  })

  it('caps pagination inputs', () => {
    expect(pageLimitSchema.parse(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE)
    expect(() => pageLimitSchema.parse(MAX_PAGE_SIZE + 1)).toThrow()
    expect(() => pageLimitSchema.parse(0)).toThrow()
    expect(() => pageOffsetSchema.parse(-1)).toThrow()
    expect(() => pageOffsetSchema.parse(MAX_PAGE_OFFSET + 1)).toThrow()
  })

  it('accepts same-origin cookie mutations', () => {
    expect(
      validateCookieMutationOrigin(mutationRequest('https://cms.example.test')),
    ).toBeNull()
  })

  it('honors forwarded protocol without trusting a forwarded host', () => {
    expect(
      validateCookieMutationOrigin(
        mutationRequest('https://cms.example.test:8443', {
          host: 'cms.example.test:8443',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBeNull()

    expect(
      validateCookieMutationOrigin(
        mutationRequest('https://attacker.example.test', {
          'x-forwarded-host': 'attacker.example.test',
        }),
      )?.status,
    ).toBe(403)
  })

  it('accepts configured public origins behind a reverse proxy', () => {
    expect(
      validateCookieMutationOrigin(
        mutationRequest('https://public.example.test', {
          host: 'cms:3000',
          'x-forwarded-host': 'public.example.test',
          'x-forwarded-proto': 'https',
        }),
        ['https://public.example.test'],
      ),
    ).toBeNull()
  })

  it('rejects missing, malformed, and cross-origin origins', () => {
    expect(validateCookieMutationOrigin(mutationRequest())?.status).toBe(403)
    expect(
      validateCookieMutationOrigin(mutationRequest('not a URL'))?.status,
    ).toBe(403)
    expect(
      validateCookieMutationOrigin(
        mutationRequest('https://attacker.example.test'),
      )?.status,
    ).toBe(403)
  })

  it('does not interfere with safe, bearer-only, or auth requests', () => {
    expect(
      validateCookieMutationOrigin(
        new Request('https://cms.example.test/resource', {
          headers: { cookie: 'session=valid' },
        }),
      ),
    ).toBeNull()
    expect(
      validateCookieMutationOrigin(
        new Request('https://cms.example.test/api/sites/manifest', {
          method: 'POST',
          headers: { authorization: 'Bearer token' },
        }),
      ),
    ).toBeNull()
    expect(
      validateCookieMutationOrigin(
        new Request('https://cms.example.test/api/auth/sign-in/email', {
          method: 'POST',
          headers: { cookie: 'session=valid' },
        }),
      ),
    ).toBeNull()
  })
})
