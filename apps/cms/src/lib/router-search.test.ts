import { makeSignature } from 'better-auth/crypto'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { describe, expect, it } from 'vitest'

import {
  parseSearchKeepingRepeats,
  stringifySearchKeepingRepeats,
} from './router-search'

// The shape of a Better Auth signed authorization query (values made up).
const signedQuery =
  'response_type=code&client_id=abc-123&redirect_uri=http%3A%2F%2Flocalhost%3A4599%2Fcallback' +
  '&scope=mcp+offline_access&state=s123&exp=1791648871&ba_iat=1791648271896' +
  '&ba_param=ba_iat&ba_param=ba_param&ba_param=client_id&ba_param=exp' +
  '&sig=4BHZWfdXzq0WbDWECZwWPqfMSJYAYEq85sWO9Qutwi4%3D'

describe('stringifySearchKeepingRepeats', () => {
  it('keeps a signed query byte-for-byte equal in meaning', () => {
    const parsed = parseSearchKeepingRepeats(`?${signedQuery}`)
    const written = stringifySearchKeepingRepeats(parsed)
    const params = new URLSearchParams(written.slice(1))
    expect(params.getAll('ba_param')).toEqual([
      'ba_iat',
      'ba_param',
      'client_id',
      'exp',
    ])
    expect(params.get('sig')).toBe(
      '4BHZWfdXzq0WbDWECZwWPqfMSJYAYEq85sWO9Qutwi4=',
    )
    expect(params.get('client_id')).toBe('abc-123')
    expect(params.get('ba_iat')).toBe('1791648271896')
    expect(params.get('scope')).toBe('mcp offline_access')
    expect(written).not.toContain('[')
  })

  it('reads back to the same search object', () => {
    const parsed = parseSearchKeepingRepeats(`?${signedQuery}`)
    expect(
      parseSearchKeepingRepeats(stringifySearchKeepingRepeats(parsed)),
    ).toEqual(parsed)
  })

  it('leaves the default encoding for single values and other arrays', () => {
    expect(
      stringifySearchKeepingRepeats({ panel: 'activity', invite: 1 }),
    ).toBe('?panel=activity&invite=1')
    expect(stringifySearchKeepingRepeats({ ids: ['only'] })).toBe(
      '?ids=%5B%22only%22%5D',
    )
    expect(stringifySearchKeepingRepeats({ nums: [1, 2] })).toBe(
      '?nums=%5B1%2C2%5D',
    )
    expect(stringifySearchKeepingRepeats({})).toBe('')
  })

  it('does not write string arrays that would read back as numbers', () => {
    const written = stringifySearchKeepingRepeats({ codes: ['10', '20'] })
    expect(written).toBe('?codes=%5B%2210%22%2C%2220%22%5D')
    expect(parseSearchKeepingRepeats(written)).toEqual({ codes: ['10', '20'] })
  })
})

describe('signed OAuth search strings', () => {
  it.each(['1e3', '9007199254740993', '"abc"', '[1, 2]', 'true', '', 'é + &='])(
    'preserves a real authorization signature with opaque state %j',
    async (state) => {
      const secret = 'router-signature-regression-secret'
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: 'test-client',
        state,
        exp: String(Math.floor(Date.now() / 1000) + 600),
      })
      params.append('resource', 'https://cms.example.com/api/mcp/site-one')
      params.append('resource', 'https://cms.example.com/api/mcp/site-two')
      // Repeated opaque extension values must also remain strings.
      params.append('extension', '123')
      params.append('extension', 'false')
      for (const key of [...new Set([...params.keys(), 'ba_param'])].sort()) {
        params.append('ba_param', key)
      }
      const canonical = new URLSearchParams(
        [...params.entries()].sort(([a, av], [b, bv]) =>
          a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0,
        ),
      )
      params.set('sig', await makeSignature(canonical.toString(), secret))
      const signed = params.toString()
      expect(await verifyOAuthQueryParams(signed, secret)).toBe(true)

      const parsed = parseSearchKeepingRepeats(`?${signed}`)
      const written = stringifySearchKeepingRepeats(parsed)
      expect(await verifyOAuthQueryParams(written.slice(1), secret)).toBe(true)
      expect(new URLSearchParams(written).get('state')).toBe(state)
      expect(new URLSearchParams(written).getAll('extension')).toEqual([
        '123',
        'false',
      ])
      expect(new URLSearchParams(written).getAll('resource')).toEqual(
        params.getAll('resource'),
      )
    },
  )

  it('retains ordinary application JSON parsing', () => {
    expect(
      parseSearchKeepingRepeats(
        '?page=2&enabled=true&filter=%7B%22name%22%3A%22test%22%7D',
      ),
    ).toEqual({
      page: 2,
      enabled: true,
      filter: { name: 'test' },
    })
  })
})
