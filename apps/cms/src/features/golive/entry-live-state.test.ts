import { describe, expect, it } from 'vitest'

import { entryUiStatus, isEditedSinceReady } from './entry-live-state'

const live = { createdAt: '2026-01-10T10:00:00Z' }

describe('entryUiStatus', () => {
  it('maps draft, scheduled and archived straight through', () => {
    for (const status of ['draft', 'scheduled', 'archived'] as const) {
      expect(entryUiStatus({ status, updatedAt: '2026-01-01' }, live)).toBe(
        status,
      )
    }
  })

  it('is Ready when changed after the live release', () => {
    expect(
      entryUiStatus(
        { status: 'published', updatedAt: '2026-01-11T00:00:00Z' },
        live,
      ),
    ).toBe('ready')
  })

  it('is Live when the live release includes it', () => {
    expect(
      entryUiStatus(
        { status: 'published', updatedAt: '2026-01-09T00:00:00Z' },
        live,
      ),
    ).toBe('live')
  })

  it('is Ready when nothing is live yet', () => {
    expect(
      entryUiStatus({ status: 'published', updatedAt: '2026-01-09' }, null),
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
