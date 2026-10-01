import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resetGeneratedSetupToken,
  resolveSetupToken,
  setupTokenMatches,
} from './setup-token.ts'

afterEach(() => resetGeneratedSetupToken())

describe('resolveSetupToken', () => {
  it('uses the configured token as is and never logs it', () => {
    const log = vi.fn()
    expect(resolveSetupToken('configured-token-1234', true, log)).toBe(
      'configured-token-1234',
    )
    expect(log).not.toHaveBeenCalled()
  })

  it('generates one token per process and logs it exactly once', () => {
    const log = vi.fn()
    const first = resolveSetupToken(undefined, true, log)
    const second = resolveSetupToken(undefined, true, log)
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(second).toBe(first)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain(first)
    expect(log.mock.calls[0]?.[0]).toContain('First-run setup token')
  })

  it('produces nothing, and logs nothing, once the instance is set up', () => {
    const log = vi.fn()
    expect(resolveSetupToken(undefined, false, log)).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('forgets the generated token after setup completes', () => {
    const log = vi.fn()
    const token = resolveSetupToken(undefined, true, log)
    expect(resolveSetupToken(undefined, false, log)).toBeNull()
    expect(resolveSetupToken(undefined, true, log)).not.toBe(token)
  })
})

describe('setupTokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(
      setupTokenMatches('abc-token-1234567890', 'abc-token-1234567890'),
    ).toBe(true)
    expect(
      setupTokenMatches('abc-token-1234567891', 'abc-token-1234567890'),
    ).toBe(false)
    expect(setupTokenMatches('short', 'abc-token-1234567890')).toBe(false)
  })

  it('rejects a missing or empty token', () => {
    expect(setupTokenMatches(undefined, 'abc-token-1234567890')).toBe(false)
    expect(setupTokenMatches('', 'abc-token-1234567890')).toBe(false)
  })

  it('rejects everything when no token is expected', () => {
    expect(setupTokenMatches('anything', null)).toBe(false)
    expect(setupTokenMatches('', null)).toBe(false)
    expect(setupTokenMatches(undefined, null)).toBe(false)
  })
})
