import { describe, expect, it } from 'vitest'

import { entryUiStatus, isEditedSinceReady } from './entry-live-state'

const live = {
  liveEntryIds: ['live-1'],
  liveSlugsByEntryId: { 'live-1': 'hello' },
  pendingEntryIds: [] as string[],
}

describe('entryUiStatus', () => {
  it('maps draft, scheduled and archived straight through', () => {
    for (const status of ['draft', 'scheduled', 'archived'] as const) {
      expect(
        entryUiStatus({ id: 'live-1', status, updatedAt: '2026-01-01' }, live),
      ).toBe(status)
    }
  })

  it('is Ready when the live snapshot does not contain the entry', () => {
    expect(
      entryUiStatus(
        {
          id: 'new-1',
          status: 'published',
          publishedSlug: 'fresh',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        live,
      ),
    ).toBe('ready')
  })

  it('is Ready when the approved slug no longer matches the live snapshot', () => {
    expect(
      entryUiStatus(
        {
          id: 'live-1',
          status: 'published',
          publishedSlug: 'renamed',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        live,
      ),
    ).toBe('ready')
  })

  it('is Ready when the approved version is pending against live', () => {
    expect(
      entryUiStatus(
        {
          id: 'live-1',
          status: 'published',
          publishedSlug: 'hello',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        { ...live, pendingEntryIds: ['live-1'] },
      ),
    ).toBe('ready')
  })

  it('is Live when the live snapshot contains this id with the approved slug', () => {
    expect(
      entryUiStatus(
        {
          id: 'live-1',
          status: 'published',
          publishedSlug: 'hello',
          updatedAt: '2026-01-11T00:00:00Z',
        },
        live,
      ),
    ).toBe('live')
  })

  it('does not use updatedAt to decide Ready vs Live', () => {
    expect(
      entryUiStatus(
        {
          id: 'live-1',
          status: 'published',
          publishedSlug: 'hello',
          updatedAt: '2099-01-01T00:00:00Z',
        },
        live,
      ),
    ).toBe('live')
  })

  it('is Ready when nothing is live yet', () => {
    expect(
      entryUiStatus(
        { id: 'live-1', status: 'published', updatedAt: '2026-01-09' },
        null,
      ),
    ).toBe('ready')
  })
})

describe('isEditedSinceReady', () => {
  it('compares draft and published data regardless of key order', () => {
    expect(
      isEditedSinceReady({
        status: 'published',
        updatedAt: '',
        draftData: { a: 1, b: 2 },
        publishedData: { b: 2, a: 1 },
      }),
    ).toBe(false)
    expect(
      isEditedSinceReady({
        status: 'published',
        updatedAt: '',
        draftData: { a: 1 },
        publishedData: { a: 2 },
      }),
    ).toBe(true)
  })
})
