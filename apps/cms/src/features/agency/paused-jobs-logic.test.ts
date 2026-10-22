import { describe, expect, it } from 'vitest'

import {
  clientDiffersFromSite,
  errorSummary,
  pausedRows,
  storageFileName,
} from './paused-jobs-logic'

describe('pausedRows', () => {
  it('lists storage deletions first, then schedules, keeping the server order', () => {
    const rows = pausedRows({
      storage: [
        {
          kind: 'storage',
          id: 'sites/acme/uploads/hero-banner.webp',
          attempts: 4,
          lastError: 'a',
          queuedAt: new Date(0),
        },
        {
          kind: 'storage',
          id: 'sites/acme/uploads/team-photo-2026.jpg',
          attempts: 5,
          lastError: null,
          queuedAt: new Date(0),
        },
      ],
      schedules: [
        {
          kind: 'schedule',
          id: 'site-1',
          siteName: 'Acme',
          organizationName: 'Harbour',
          attempts: 4,
          lastError: 'Health check failed',
          lastAttemptAt: new Date(0),
        },
      ],
    })

    expect(rows.map((row) => row.key)).toEqual([
      'storage:sites/acme/uploads/hero-banner.webp',
      'storage:sites/acme/uploads/team-photo-2026.jpg',
      'schedule:site-1',
    ])
    expect(rows[0]).toMatchObject({
      kind: 'storage',
      storageKey: 'sites/acme/uploads/hero-banner.webp',
      attempts: 4,
      at: new Date(0),
    })
    expect(rows[2]).toMatchObject({
      kind: 'schedule',
      siteName: 'Acme',
      organizationName: 'Harbour',
      attempts: 4,
      at: new Date(0),
    })
    expect(rows[2].storageKey).toBeUndefined()
  })

  it('is empty before the list has loaded', () => {
    expect(pausedRows(undefined)).toEqual([])
  })
})

describe('storageFileName', () => {
  it('returns the last path segment', () => {
    expect(storageFileName('sites/acme/uploads/hero-banner.webp')).toBe(
      'hero-banner.webp',
    )
  })

  it('keeps a key without slashes, and ignores trailing ones', () => {
    expect(storageFileName('orphan.png')).toBe('orphan.png')
    expect(storageFileName('sites/acme/uploads/photo.jpg/')).toBe('photo.jpg')
  })

  it('falls back to the whole key when there is no name', () => {
    expect(storageFileName('/')).toBe('/')
  })
})

describe('errorSummary', () => {
  it('takes the first non-blank line and trims it', () => {
    expect(
      errorSummary(
        '\n  connect ETIMEDOUT 10.20.30.41:9000\n    at TCPConnectWrap',
      ),
    ).toBe('connect ETIMEDOUT 10.20.30.41:9000')
  })

  it('is null when there is nothing to show', () => {
    expect(errorSummary(null)).toBeNull()
    expect(errorSummary('  \n ')).toBeNull()
  })
})

describe('clientDiffersFromSite', () => {
  it('ignores case and surrounding space', () => {
    expect(clientDiffersFromSite(' Acme ', 'acme')).toBe(false)
  })

  it('is true when the client adds something to the site name', () => {
    expect(clientDiffersFromSite('acme-site', 'Acme')).toBe(true)
  })
})
