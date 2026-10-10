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
