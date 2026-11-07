import { describe, expect, it } from 'vitest'

import { isExplicitTrigger } from './save-intent'

describe('isExplicitTrigger', () => {
  it('is explicit for the Save button, ⌘S and Mark ready only', () => {
    expect(isExplicitTrigger('save')).toBe(true)
    expect(isExplicitTrigger('mark-ready')).toBe(true)
  })

  it('is not explicit for autosaves, background saves and the other actions', () => {
    expect(isExplicitTrigger('autosave')).toBe(false)
    expect(isExplicitTrigger('background')).toBe(false)
    expect(isExplicitTrigger('action')).toBe(false)
  })
})
