import { describe, expect, it } from 'vitest'

import { canGoLive } from './go-live-gate.ts'

describe('canGoLive', () => {
  it('allows a publisher when nothing blocks the site', () => {
    expect(canGoLive({ canPublish: true, blockers: [] })).toBe(true)
    expect(canGoLive({ canPublish: true })).toBe(true)
  })

  it('refuses a publisher while a section blocks the site', () => {
    expect(
      canGoLive({
        canPublish: true,
        blockers: ['Site content "Company info" has never been marked ready.'],
      }),
    ).toBe(false)
  })

  it('refuses a role that cannot publish, blocked or not', () => {
    expect(canGoLive({ canPublish: false, blockers: [] })).toBe(false)
  })
})
