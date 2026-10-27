import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import { bulkEntryActionFn } from '#/server/fn/content'
import { callServerFn, seedWorld } from '#/server/security/authz-harness'
import type { World } from '#/server/security/authz-harness'
import { createEntry, getEntry } from './entries'
import { sampleRichText } from './test-utils'

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

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('bulk entry actions on a normal site', () => {
  let w: World

  beforeAll(async () => {
    w = await seedWorld()
  })

  afterAll(async () => {
    await w.destroy()
  })

  /** A ready article in the org's site, as the owner who wrote it. */
  async function article(slug: string, publish = true) {
    const row = await createEntry({
      siteId: w.X.site.id,
      collectionKey: 'articles',
      data: { title: `Title ${slug}`, slug, body: sampleRichText },
      actorId: w.users.ownerX.id,
    })
    if (publish) {
      const { publishEntry } = await import('./entries')
      await publishEntry(row.id, w.users.ownerX.id)
    }
    return row.id
  }

  type Outcome = {
    result?: { results: { id: string; ok: boolean; error?: string }[] }
    error?: unknown
  }

  /** Runs the bulk action as the actor; the outcome carries the result or the error. */
  async function run(
    action: 'ready' | 'draft' | 'archive' | 'delete',
    ids: string[],
    actor: 'ownerX' | 'editorX' = 'ownerX',
  ): Promise<Outcome> {
    return (await callServerFn(
      bulkEntryActionFn as Parameters<typeof callServerFn>[0],
      { siteId: w.X.site.id, action, ids },
      w.sessions[actor],
    )) as Outcome
  }

  /** The results of an allowed call. */
  async function results(
    action: 'ready' | 'draft' | 'archive' | 'delete',
    ids: string[],
  ) {
    const outcome = await run(action, ids)
    if (outcome.error) throw outcome.error
    return outcome.result!.results
  }

  it('applies each id on its own and reports the one that failed', async () => {
    const good = await article('bulk-good', false)
    const foreign = await createEntry({
      siteId: w.Y.site.id,
      collectionKey: 'articles',
      data: {
        title: 'Elsewhere',
        slug: 'bulk-elsewhere',
        body: sampleRichText,
      },
      actorId: w.users.ownerY.id,
    })

    const list = await results('ready', [good, foreign.id])

    expect(list).toEqual([
      { id: good, ok: true },
      expect.objectContaining({ id: foreign.id, ok: false }),
    ])
    expect(list[1]?.error).toBeTruthy()
    expect((await getEntry(good))?.status).toBe('published')
    expect((await getEntry(foreign.id))?.status).toBe('draft')
  })

  it('moves entries back to draft, archives them and deletes them', async () => {
    const back = await article('bulk-back')
    const archived = await article('bulk-archived')
    const removed = await article('bulk-removed', false)

    expect(await results('draft', [back])).toEqual([{ id: back, ok: true }])
    expect((await getEntry(back))?.status).toBe('draft')

    expect(await results('archive', [archived])).toEqual([
      { id: archived, ok: true },
    ])
    expect((await getEntry(archived))?.status).toBe('archived')

    expect(await results('delete', [removed])).toEqual([
      { id: removed, ok: true },
    ])
    const rows = await db
      .select({ id: entry.id })
      .from(entry)
      .where(eq(entry.id, removed))
    expect(rows).toHaveLength(0)
  })

  it('refuses the whole batch to an editor, as each single action refuses', async () => {
    const target = await article('bulk-editor', false)
    const outcome = await run('archive', [target], 'editorX')
    expect(outcome.error).toBeDefined()
    expect(outcome.result).toBeUndefined()
    expect((await getEntry(target))?.status).toBe('draft')
  })
})
