import { describe, expect, it } from 'vitest'

import { releaseRequesterKey } from './release-requester'

describe('releaseRequesterKey', () => {
  it('names the person who started a release', () => {
    expect(
      releaseRequesterKey({ requestedByName: 'Jane', origin: 'manual' }),
    ).toEqual({ kind: 'person', name: 'Jane' })
  })

  it('says the scheduler started a release with no requester', () => {
    expect(
      releaseRequesterKey({ requestedByName: null, origin: 'scheduled' }),
    ).toEqual({ kind: 'automatic' })
  })

  it('says the person is deleted when a manual or rollback release has no requester', () => {
    expect(
      releaseRequesterKey({ requestedByName: null, origin: 'manual' }),
    ).toEqual({ kind: 'deleted' })
    expect(
      releaseRequesterKey({ requestedByName: null, origin: 'rollback' }),
    ).toEqual({ kind: 'deleted' })
  })
})
