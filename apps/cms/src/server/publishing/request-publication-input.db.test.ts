import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { publication } from '#/db/schema'
import * as publishingFns from '#/server/fn/publishing'
import { callServerFn, seedWorld } from '#/server/security/authz-harness'
import type { World } from '#/server/security/authz-harness'

// Must run before `#/env` is first imported: guards read ADMIN_MFA_REQUIRED.
vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})
vi.mock('#/lib/auth', async () =>
  (await import('#/server/security/authz-state')).fakeAuth(),
)
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => null,
}))
vi.mock('@tanstack/react-start', async (importOriginal) =>
  (await import('#/server/security/authz-start-patch')).patchStart(
    await importOriginal(),
  ),
)

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Never run against a developer database: only throwaway/isolated names.
const runnable = /authz|test|e2e|bench|tmp/i.test(dbName)

describe.skipIf(!runnable)('requestPublicationFn input', () => {
  let w: World

  beforeAll(async () => {
    w = await seedWorld()
  }, 60_000)
  afterAll(async () => {
    await w.destroy()
  })

  const request = async (input: { priority?: unknown; note?: unknown }) => {
    const target = await w.fresh.site('X')
    const outcome = await callServerFn(
      publishingFns.requestPublicationFn as Parameters<typeof callServerFn>[0],
      { siteId: target.id, requestKey: crypto.randomUUID(), ...input },
      w.sessions.ownerX,
    )
    const rows = await db
      .select({ id: publication.id })
      .from(publication)
      .where(eq(publication.siteId, target.id))
    return { error: outcome.error, publications: rows.length }
  }

  it.each([0, 100, undefined])('accepts priority %j', async (priority) => {
    const { error } = await request({ priority })
    expect(error).toBeUndefined()
  })

  it.each([1, 99, 101, -1, 2147483647])(
    'refuses priority %j before anything is queued',
    async (priority) => {
      const { error, publications } = await request({ priority })
      expect(error).toBeDefined()
      expect(publications).toBe(0)
    },
  )

  it('accepts a note of 500 characters and refuses a longer one', async () => {
    expect((await request({ note: 'n'.repeat(500) })).error).toBeUndefined()
    const refused = await request({ note: 'n'.repeat(501) })
    expect(refused.error).toBeDefined()
    expect(refused.publications).toBe(0)
  })
})
