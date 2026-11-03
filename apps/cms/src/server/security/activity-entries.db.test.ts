import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestGlobal } from '#/server/content/test-utils'
import { getActivityEntriesFn } from '#/server/fn/activity-entries'

import { callServerFn, seedWorld } from './authz-harness'
import type { World } from './authz-harness'

// Must run before `#/env` is first imported: guards read ADMIN_MFA_REQUIRED.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

vi.mock('#/lib/auth', async () => (await import('./authz-state')).fakeAuth())
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('./authz-start-patch')).patchStart(await importOriginal()),
)

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Same rule as the other authorization suites: never run against a developer database.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

describe.skipIf(!runnable)('getActivityEntriesFn', () => {
  let world: World
  let hiddenEntryId: string
  let visibleGlobalEntryId: string

  beforeAll(async () => {
    world = await seedWorld()
    // A disabled site section of tenant X: hidden from editors and owners.
    const hidden = await createTestGlobal(world.X.site.id, {
      key: `hidden${world.run}`,
      label: 'Hidden section',
      enabled: false,
    })
    hiddenEntryId = hidden.entry.id
    const visible = await createTestGlobal(world.X.site.id, {
      key: `shown${world.run}`,
      label: 'Shown section',
      enabled: true,
    })
    visibleGlobalEntryId = visible.entry.id
  })

  afterAll(async () => {
    await world.destroy()
  })

  function lookup(ids: string[], actor: keyof World['sessions']) {
    return callServerFn(
      getActivityEntriesFn as Parameters<typeof callServerFn>[0],
      { ids },
      world.sessions[actor],
    )
  }

  it('returns the accessible entries with the fields the feed shows', async () => {
    const outcome = await lookup([world.X.entry.id], 'editorX')
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toEqual([
      {
        id: world.X.entry.id,
        siteId: world.X.site.id,
        collectionKey: 'articles',
        global: false,
        title: expect.stringMatching(/^Entry e-/),
      },
    ])
  })

  it('omits an entry of another tenant without failing the request', async () => {
    const outcome = await lookup([world.Y.entry.id], 'editorX')
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toEqual([])
  })

  it('returns only the readable entries of a mixed list', async () => {
    const outcome = await lookup(
      [world.X.entry.id, world.Y.entry.id, 'missing-entry-id'],
      'ownerX',
    )
    expect(outcome.error).toBeUndefined()
    expect((outcome.result as Array<{ id: string }>).map((e) => e.id)).toEqual([
      world.X.entry.id,
    ])
  })

  it('omits a hidden section entry for a non-admin, but not for an agency admin', async () => {
    const forEditor = await lookup(
      [hiddenEntryId, visibleGlobalEntryId],
      'editorX',
    )
    expect(forEditor.error).toBeUndefined()
    const editorIds = (forEditor.result as Array<{ id: string }>).map(
      (e) => e.id,
    )
    expect(editorIds).toEqual([visibleGlobalEntryId])

    const forAdmin = await lookup([hiddenEntryId], 'adminMfa')
    expect(forAdmin.error).toBeUndefined()
    expect(forAdmin.result).toEqual([
      expect.objectContaining({ id: hiddenEntryId, global: true }),
    ])
  })

  it('returns an empty list for an empty request', async () => {
    const outcome = await lookup([], 'editorX')
    expect(outcome.result).toEqual([])
  })

  it('refuses an anonymous caller like getEntryFn does', async () => {
    const outcome = await lookup([world.X.entry.id], 'anonymous')
    expect(outcome.error).toBeDefined()
  })
})
