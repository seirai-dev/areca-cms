import { describe, expect, it } from 'vitest'

import {
  parseStoredMode,
  parseStoredRatio,
  parseStoredWidth,
} from './visual-preferences'
import { shouldEnterVisualOnMount } from './visual-mode'

describe('parseStoredRatio', () => {
  it('reads a stored ratio', () => {
    expect(parseStoredRatio('0.42')).toBeCloseTo(0.42)
  })

  it('treats a missing value as no choice', () => {
    expect(parseStoredRatio(null)).toBeNull()
  })

  it('ignores garbage and out-of-range values', () => {
    expect(parseStoredRatio('abc')).toBeNull()
    expect(parseStoredRatio('-0.2')).toBeNull()
    expect(parseStoredRatio('1.5')).toBeNull()
    expect(parseStoredRatio('NaN')).toBeNull()
  })
})

describe('parseStoredWidth', () => {
  it('accepts the known presets', () => {
    expect(parseStoredWidth('tablet')).toBe('tablet')
    expect(parseStoredWidth('fit1440')).toBe('fit1440')
  })

  it('defaults to desktop for anything else', () => {
    expect(parseStoredWidth(null)).toBe('desktop')
    expect(parseStoredWidth('huge')).toBe('desktop')
  })
})

describe('parseStoredMode', () => {
  it('accepts write and visual', () => {
    expect(parseStoredMode('write')).toBe('write')
    expect(parseStoredMode('visual')).toBe('visual')
  })

  it('returns null when nothing valid is stored', () => {
    expect(parseStoredMode(null)).toBeNull()
    expect(parseStoredMode('preview')).toBeNull()
  })
})

describe('shouldEnterVisualOnMount', () => {
  const base = {
    hasViewParam: false,
    lastMode: 'visual' as const,
    available: true,
    autoEnter: true,
  }

  it('enters visual when the last mode was visual and the viewport allows it', () => {
    expect(shouldEnterVisualOnMount(base)).toBe(true)
  })

  it('does not override an explicit view param', () => {
    expect(shouldEnterVisualOnMount({ ...base, hasViewParam: true })).toBe(
      false,
    )
  })

  it('stays in write mode when the last mode was write', () => {
    expect(shouldEnterVisualOnMount({ ...base, lastMode: 'write' })).toBe(false)
  })

  it('stays in write mode below the visual viewport', () => {
    expect(shouldEnterVisualOnMount({ ...base, available: false })).toBe(false)
  })

  it('is skipped when the caller opts out (new entries)', () => {
    expect(shouldEnterVisualOnMount({ ...base, autoEnter: false })).toBe(false)
  })
})
