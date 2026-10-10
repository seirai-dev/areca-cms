import { describe, expect, it } from 'vitest'
import { visiblePickerAssets } from './media-picker-pages'

describe('media picker pages', () => {
  it('removes overlaps caused by an upload shifting later offset pages', () => {
    const first = [0, 1, 2, 3].map((id) => ({
      id: String(id),
      name: `old-${id}`,
    }))
    // A new upload shifted the next page back by one existing row. Its copy
    // also carries newer metadata; the first position should stay stable.
    const second = [2, 3, 4, 5].map((id) => ({
      id: String(id),
      name: `new-${id}`,
    }))
    expect(visiblePickerAssets([first, second], 3)).toEqual([
      { id: '0', name: 'old-0' },
      { id: '1', name: 'old-1' },
      { id: '2', name: 'new-2' },
      { id: '3', name: 'new-3' },
      { id: '4', name: 'new-4' },
    ])
  })
  it('keeps a short final page and removes its repeated boundary row', () => {
    const pages = [
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'b' }, { id: 'c' }],
    ]
    expect(visiblePickerAssets(pages, 2)).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ])
  })
})
