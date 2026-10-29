import { describe, expect, it } from 'vitest'

import { modifierLabels } from './kbd'

describe('modifierLabels', () => {
  it('uses the Command and Shift glyphs on Apple platforms', () => {
    expect(modifierLabels('MacIntel')).toEqual({ mod: '⌘', shift: '⇧' })
    expect(modifierLabels('iPhone')).toEqual({ mod: '⌘', shift: '⇧' })
  })

  it('uses Ctrl and Shift elsewhere', () => {
    expect(modifierLabels('Win32')).toEqual({ mod: 'Ctrl', shift: 'Shift' })
    expect(modifierLabels('Linux x86_64')).toEqual({
      mod: 'Ctrl',
      shift: 'Shift',
    })
    expect(modifierLabels('')).toEqual({ mod: 'Ctrl', shift: 'Shift' })
  })
})
