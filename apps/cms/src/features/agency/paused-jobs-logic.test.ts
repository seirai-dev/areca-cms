import { describe, expect, it } from 'vitest'

import { pausedRows } from './paused-jobs-logic'

describe('pausedRows', () => {
  it('lists storage deletions first, then schedules, keeping the server order', () => {
    const rows = pausedRows({
      storage: [
        {
          kind: 'storage',
          id: 'k-2',
          attempts: 4,
          lastError: 'a',
          queuedAt: new Date(0),
        },
        {
          kind: 'storage',
          id: 'k-1',
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
      'storage:k-2',
      'storage:k-1',
      'schedule:site-1',
    ])
    expect(rows[2]).toMatchObject({
      kind: 'schedule',
      siteName: 'Acme',
      organizationName: 'Harbour',
      attempts: 4,
    })
  })

  it('is empty before the list has loaded', () => {
    expect(pausedRows(undefined)).toEqual([])
  })
})
