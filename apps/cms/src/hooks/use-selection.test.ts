import { describe, expect, it } from 'vitest'

import { toggledSelection } from './use-selection'

describe('toggledSelection', () => {
  it('flips an id when no direction is given', () => {
    const on = toggledSelection(new Set(), 'a')
    expect([...on]).toEqual(['a'])
    expect([...toggledSelection(on, 'a')]).toEqual([])
  })

  it('sets the id on or off as asked, without touching the input', () => {
    const current = new Set(['a'])
    expect([...toggledSelection(current, 'a', true)]).toEqual(['a'])
    expect([...toggledSelection(current, 'b', true)]).toEqual(['a', 'b'])
    expect([...toggledSelection(current, 'a', false)]).toEqual([])
    expect([...current]).toEqual(['a'])
  })
})
