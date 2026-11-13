import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

// TanStack Start runs seroval `fromJSON` on every server-function payload
// before any middleware or auth. seroval <= 1.6.7 looped over an
// attacker-chosen array length (GHSA-97r2-qh9m-474h); the workspace override
// in pnpm-workspace.yaml keeps the patched version.
async function loadStartSeroval() {
  const fromCms = createRequire(import.meta.url)
  const fromStart = createRequire(
    fromCms.resolve('@tanstack/react-start/package.json'),
  )
  const fromServerCore = createRequire(
    fromStart.resolve('@tanstack/start-server-core/package.json'),
  )
  const entry = fromServerCore.resolve('seroval')
  const version = (
    fromServerCore('seroval/package.json') as { version: string }
  ).version
  const seroval = (await import(pathToFileURL(entry).href)) as {
    fromJSON: (value: unknown) => unknown
    toJSON: (value: unknown) => unknown
  }
  return { seroval, version }
}

describe('seroval used by TanStack Start', () => {
  it('is a patched 1.6.x release', async () => {
    const { version } = await loadStartSeroval()
    const [major, minor, patch] = version.split('.').map(Number)
    expect(major).toBe(1)
    expect(minor).toBe(6)
    expect(patch).toBeGreaterThanOrEqual(12)
  })

  it('rejects a forged array length at once', async () => {
    const { seroval } = await loadStartSeroval()
    const payload = JSON.parse(
      '{"t":{"t":9,"i":0,"a":{"length":4294967295},"o":0},"f":127,"m":[]}',
    ) as unknown
    const started = performance.now()
    expect(() => seroval.fromJSON(payload)).toThrow()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('still round-trips a normal payload', async () => {
    const { seroval } = await loadStartSeroval()
    const value = { data: { id: 'a', list: [1, 2, 3] } }
    expect(seroval.fromJSON(seroval.toJSON(value))).toEqual(value)
  })
})
