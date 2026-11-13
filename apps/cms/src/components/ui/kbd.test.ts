import { describe, expect, it } from 'vitest'

import { modifierLabels, shortcutLabel } from './kbd'

describe('modifierLabels', () => {
  it('uses the Command and Shift glyphs on Apple platforms', () => {
    expect(modifierLabels('MacIntel')).toEqual({
      mod: '⌘',
      shift: '⇧',
      alt: '⌥',
    })
    expect(modifierLabels('iPhone')).toEqual({ mod: '⌘', shift: '⇧', alt: '⌥' })
  })

  it('uses Ctrl and Shift elsewhere', () => {
    expect(modifierLabels('Win32')).toEqual({
      mod: 'Ctrl',
      shift: 'Shift',
      alt: 'Alt',
    })
    expect(modifierLabels('Linux x86_64')).toEqual({
      mod: 'Ctrl',
      shift: 'Shift',
      alt: 'Alt',
    })
    expect(modifierLabels('')).toEqual({
      mod: 'Ctrl',
      shift: 'Shift',
      alt: 'Alt',
    })
  })
})

describe('shortcutLabel', () => {
  it('keeps the Apple glyphs on Apple platforms', () => {
    expect(shortcutLabel('⌘⌥2', 'MacIntel')).toBe('⌘⌥2')
    expect(shortcutLabel('⌘⇧Z', 'iPad')).toBe('⌘⇧Z')
  })

  it('spells the modifiers out elsewhere', () => {
    expect(shortcutLabel('⌘⌥2', 'Win32')).toBe('Ctrl+Alt+2')
    expect(shortcutLabel('⌘⇧8', 'Linux x86_64')).toBe('Ctrl+Shift+8')
    expect(shortcutLabel('⌘B', '')).toBe('Ctrl+B')
  })
})
