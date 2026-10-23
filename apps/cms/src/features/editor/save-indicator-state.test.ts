import { describe, expect, it } from 'vitest'

import { saveIndicatorKind } from './save-indicator-state'

const idle = {
  status: 'idle',
  isNew: false,
  conflict: false,
  errorCount: 0,
  fresh: false,
} as const

describe('saveIndicatorKind', () => {
  it('shows a draft conflict instead of any save state', () => {
    expect(
      saveIndicatorKind({ ...idle, status: 'failed', conflict: true }),
    ).toBe('conflict')
    expect(
      saveIndicatorKind({ ...idle, status: 'saving', conflict: true }),
    ).toBe('conflict')
    expect(
      saveIndicatorKind({
        ...idle,
        isNew: true,
        status: 'blocked',
        conflict: true,
      }),
    ).toBe('conflict')
  })

  it('keeps a conflict visible when the save was a failed field save', () => {
    expect(
      saveIndicatorKind({
        ...idle,
        status: 'failed',
        errorCount: 2,
        conflict: true,
      }),
    ).toBe('conflict')
  })

  it('reads a failed save as fields when there are field errors', () => {
    expect(
      saveIndicatorKind({ ...idle, status: 'failed', errorCount: 1 }),
    ).toBe('fields')
  })

  it('reads a failed save with no field errors as failed (Retry)', () => {
    expect(saveIndicatorKind({ ...idle, status: 'failed' })).toBe('failed')
  })

  it('maps saving, blocked and new entries', () => {
    expect(saveIndicatorKind({ ...idle, status: 'saving' })).toBe('saving')
    expect(saveIndicatorKind({ ...idle, isNew: true, status: 'blocked' })).toBe(
      'blocked',
    )
    expect(saveIndicatorKind({ ...idle, isNew: true })).toBe('new')
  })

  it('shows the fresh check before falling back to the saved time', () => {
    expect(saveIndicatorKind({ ...idle, status: 'saved', fresh: true })).toBe(
      'fresh',
    )
    expect(saveIndicatorKind({ ...idle, status: 'saved' })).toBe('ago')
  })
})
