import { describe, expect, it, vi } from 'vitest'
import {
  createDraftWriter,
  persistDraft,
  readRecoveredDraft,
  shouldKeepEditorOpen,
} from './draft-recovery'

describe('draft recovery and navigation', () => {
  it('keeps navigation blocked after timeout, late failure, conflict, and edits made during save', () => {
    for (const outcome of ['timeout', 'failed', 'blocked'])
      expect(shouldKeepEditorOpen(outcome, false)).toBe(true)
    expect(shouldKeepEditorOpen('saved', true)).toBe(true)
    expect(shouldKeepEditorOpen('saved', false)).toBe(false)
  })
  it('recovers exact data and baseline version after offline failure or reload', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
    const draft = {
      title: 'Unsaved',
      slug: 'unsaved',
      body: { type: 'doc', content: [] },
    }
    persistDraft(storage, 'site:entry', draft, 7)
    expect(readRecoveredDraft(storage, 'site:entry')).toEqual(draft)
    expect(JSON.parse(values.get('site:entry')!).version).toBe(7)
    expect(readRecoveredDraft(storage, 'other:entry')).toBeNull()
  })
  it('ignores damaged or nonobject browser recovery values', () => {
    for (const value of ['invalid', '{"data":null}', '{"data":[]}'])
      expect(readRecoveredDraft({ getItem: () => value }, 'entry')).toBeNull()
  })
  it('preserves browser recovery when navigation times out and the pending save fails later', async () => {
    vi.useFakeTimers()
    try {
      const values = new Map<string, string>()
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value)
        },
      }
      const data = { title: 'Last edits' }
      persistDraft(storage, 'user:site:entry', data, 3)
      const pendingSave = new Promise<string>((resolve) =>
        setTimeout(() => resolve('failed'), 5000),
      )
      const navigation = Promise.race([
        pendingSave,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('timeout'), 3000),
        ),
      ])
      await vi.advanceTimersByTimeAsync(3000)
      expect(shouldKeepEditorOpen(await navigation, true)).toBe(true)
      await vi.advanceTimersByTimeAsync(2000)
      expect(await pendingSave).toBe('failed')
      expect(readRecoveredDraft(storage, 'user:site:entry')).toEqual(data)
    } finally {
      vi.useRealTimers()
    }
  })
  it('writes the browser copy once typing pauses, or at once on flush', () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      const writer = createDraftWriter(write, 500)
      writer.flush()
      expect(write).not.toHaveBeenCalled()
      for (let key = 0; key < 5; key++) {
        writer.schedule()
        vi.advanceTimersByTime(200)
      }
      expect(write).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(write).toHaveBeenCalledTimes(1)

      writer.schedule()
      writer.flush()
      expect(write).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(1000)
      writer.flush()
      expect(write).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
