// @vitest-environment happy-dom
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Field } from '#/lib/types'

const fn = vi.hoisted(() => ({
  getEntryFn: vi.fn(),
  updateDraftFn: vi.fn(),
  updateGlobalDraftFn: vi.fn(),
  createEntryFn: vi.fn(),
  publishEntryFn: vi.fn(),
  restoreRevisionFn: vi.fn(),
  discardGlobalDraftFn: vi.fn(),
  getPreviewUrlFn: vi.fn(),
  getGlobalPreviewUrlFn: vi.fn(),
  scheduleEntryFn: vi.fn(),
  cancelScheduleFn: vi.fn(),
  unpublishEntryFn: vi.fn(),
  archiveEntryFn: vi.fn(),
  deleteEntryFn: vi.fn(),
  applySectionLinkUpdatesFn: vi.fn(),
  listCollectionsFn: vi.fn(),
  listEntryCountsFn: vi.fn(),
  listRecentEntriesFn: vi.fn(),
}))
const blockerRef = vi.hoisted(() => ({
  options: null as null | {
    shouldBlockFn: (args: {
      current: { pathname: string }
      next: { pathname: string }
    }) => Promise<boolean>
  },
}))

vi.mock('#/server/fn/content', () => fn)
vi.mock('#/server/fn/ai', () => ({ getAiAvailabilityFn: vi.fn() }))
vi.mock('#/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'user-1' } } }) },
}))
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (options: typeof blockerRef.options) => {
    blockerRef.options = options
    return { status: 'idle', proceed: vi.fn(), reset: vi.fn() }
  },
}))
vi.mock('#/features/golive/use-go-live', () => ({
  invalidateGoLiveKeys: () => Promise.resolve(),
  useGoLive: () => ({ goLive: vi.fn(), isPending: false }),
  useInvalidateGoLive: () => () => Promise.resolve(),
}))
vi.mock('#/features/dev-env/invalidate', () => ({
  invalidateDevSync: () => Promise.resolve(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

const { useEntryEditor } = await import('./use-entry-editor')

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'slug', label: 'Slug', type: 'slug' },
]
const RECOVERY_KEY = 'areca:draft:user-1:site-1:posts:entry-1'

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    slug: 'hello-page',
    status: 'draft',
    draftVersion: 1,
    draftData: { title: 'Hello', slug: 'hello-page' },
    publishedData: null,
    scheduledAt: null,
    publishedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

function conflictError() {
  return new Error('DRAFT_CONFLICT: the draft changed')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function renderEditor(
  options: Partial<Parameters<typeof useEntryEditor>[0]> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  const view = renderHook(
    () =>
      useEntryEditor({
        siteId: 'site-1',
        collectionKey: 'posts',
        fields,
        entryId: 'entry-1',
        ...options,
      }),
    { wrapper },
  )
  await tick()
  await tick()
  return { ...view, queryClient }
}

function type(
  view: { result: { current: ReturnType<typeof useEntryEditor> } },
  value: string,
) {
  act(() => view.result.current.updateField('title', value))
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  for (const mock of Object.values(fn)) mock.mockReset()
  fn.getEntryFn.mockResolvedValue(record())
  fn.getPreviewUrlFn.mockResolvedValue({ url: 'https://preview.test/hello' })
  fn.getGlobalPreviewUrlFn.mockResolvedValue({ url: 'https://preview.test/' })
  fn.updateDraftFn.mockImplementation(
    async ({ data }: { data: { data: object; expectedVersion: number } }) =>
      record({
        draftData: data.data,
        draftVersion: data.expectedVersion + 1,
      }),
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useEntryEditor: loading', () => {
  it('hydrates the server draft and is clean and ready', async () => {
    const view = await renderEditor()
    expect(view.result.current.data).toEqual({
      title: 'Hello',
      slug: 'hello-page',
    })
    expect(view.result.current.dirty).toBe(false)
    expect(view.result.current.ready).toBe(true)
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.status).toBe('idle')
  })
})

describe('useEntryEditor: autosave', () => {
  it('saves 3s after the last change with the loaded version', async () => {
    const view = await renderEditor()
    type(view, 'Hello world')
    expect(view.result.current.dirty).toBe(true)
    await tick(2999)
    expect(fn.updateDraftFn).not.toHaveBeenCalled()
    await tick(1)
    await tick()
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
    expect(fn.updateDraftFn.mock.calls[0][0].data).toMatchObject({
      id: 'entry-1',
      data: { title: 'Hello world', slug: 'hello-page' },
      expectedVersion: 1,
      explicit: false,
    })
    expect(view.result.current.status).toBe('saved')
    expect(view.result.current.dirty).toBe(false)
    expect(view.result.current.lastSavedAt).toBeInstanceOf(Date)
  })

  it('saves at most 10s after the first change while typing goes on', async () => {
    const view = await renderEditor()
    for (let i = 0; i < 6; i++) {
      type(view, `Hello ${i}`)
      await tick(2000)
    }
    // 12s of typing, a change every 2s: the max wait fired at 10s.
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
  })

  it('keeps one save in flight and saves edits made meanwhile next', async () => {
    const view = await renderEditor()
    const first = deferred<ReturnType<typeof record>>()
    fn.updateDraftFn.mockImplementationOnce(() => first.promise)
    type(view, 'One')
    await tick(3000)
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
    expect(view.result.current.status).toBe('saving')

    type(view, 'Two')
    let flushed: Promise<string> | undefined
    act(() => {
      flushed = view.result.current.persist()
    })
    await tick()
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)

    first.resolve(
      record({
        draftData: { title: 'One', slug: 'hello-page' },
        draftVersion: 2,
      }),
    )
    await tick()
    await tick()
    await act(async () => {
      await flushed
    })
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(2)
    expect(fn.updateDraftFn.mock.calls[1][0].data).toMatchObject({
      data: { title: 'Two', slug: 'hello-page' },
      expectedVersion: 2,
    })
    expect(view.result.current.dirty).toBe(false)
  })

  it('an explicit save runs once even when clean, and says explicit', async () => {
    const view = await renderEditor()
    await act(async () => {
      expect(await view.result.current.save()).toBe('saved')
    })
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
    expect(fn.updateDraftFn.mock.calls[0][0].data.explicit).toBe(true)
    // The baseline is now explicit: a second clean save has nothing to do.
    await act(async () => {
      await view.result.current.save()
    })
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
  })

  it('shows field errors from a failed save and keeps the edit', async () => {
    const view = await renderEditor()
    fn.updateDraftFn.mockRejectedValueOnce(new Error('Network down'))
    type(view, 'Broken')
    await tick(3000)
    await tick()
    expect(view.result.current.status).toBe('failed')
    expect(view.result.current.formError).toBe('Network down')
    expect(view.result.current.dirty).toBe(true)
  })

  it('takes the server copy when the server normalised the draft', async () => {
    const view = await renderEditor()
    fn.updateDraftFn.mockResolvedValueOnce(
      record({
        draftData: { title: 'Normalised', slug: 'hello-page' },
        draftVersion: 2,
      }),
    )
    type(view, 'Typed')
    await tick(3000)
    await tick()
    expect(view.result.current.data.title).toBe('Normalised')
    expect(view.result.current.dirty).toBe(false)
  })

  it('a new entry waits for a valid slug, then is created', async () => {
    const onCreated = vi.fn()
    fn.createEntryFn.mockResolvedValue(
      record({ id: 'entry-new', draftData: { title: 'Fresh', slug: 'fresh' } }),
    )
    const view = await renderEditor({ entryId: undefined, onCreated })
    expect(view.result.current.isNew).toBe(true)
    act(() => view.result.current.updateField('slug', 'Not valid!'))
    await tick(3000)
    expect(view.result.current.status).toBe('blocked')
    expect(fn.createEntryFn).not.toHaveBeenCalled()

    // The slug follows the title once reset.
    type(view, 'Fresh')
    act(() => view.result.current.resetSlugFromTitle())
    expect(view.result.current.data.slug).toBe('fresh')
    await tick(3000)
    await tick()
    expect(fn.createEntryFn).toHaveBeenCalledTimes(1)
    expect(fn.createEntryFn.mock.calls[0][0].data).toMatchObject({
      siteId: 'site-1',
      collectionKey: 'posts',
      data: { title: 'Fresh', slug: 'fresh' },
    })
    expect(onCreated).toHaveBeenCalledWith('entry-new')
    expect(view.result.current.entryId).toBe('entry-new')
  })
})

describe('useEntryEditor: draft recovery', () => {
  it('writes unsaved edits to localStorage once typing pauses', async () => {
    const view = await renderEditor()
    type(view, 'Unsaved')
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
    await tick(500)
    const stored = JSON.parse(localStorage.getItem(RECOVERY_KEY)!)
    expect(stored).toMatchObject({
      data: { title: 'Unsaved', slug: 'hello-page' },
      version: 1,
    })
    // A successful save removes the copy.
    await tick(2500)
    await tick()
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
  })

  it('offers a stored copy that differs from the server draft', async () => {
    localStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({
        data: { title: 'Lost', slug: 'hello-page' },
        version: 1,
      }),
    )
    const view = await renderEditor()
    expect(view.result.current.recoveredDraft).toEqual({
      title: 'Lost',
      slug: 'hello-page',
    })
    act(() => view.result.current.discardRecoveredDraft())
    expect(view.result.current.recoveredDraft).toBeNull()
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
  })

  it('ignores a stored copy equal to the server draft', async () => {
    localStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({
        data: { title: 'Hello', slug: 'hello-page' },
        version: 1,
      }),
    )
    const view = await renderEditor()
    expect(view.result.current.recoveredDraft).toBeNull()
  })

  it('reapplies a recovered copy over the server draft', async () => {
    localStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({
        data: { title: 'Lost', slug: 'hello-page' },
        version: 1,
      }),
    )
    const view = await renderEditor()
    await act(async () => {
      await view.result.current.reapplyRecoveredDraft()
    })
    expect(view.result.current.data.title).toBe('Lost')
    expect(view.result.current.recoveredDraft).toBeNull()
    expect(view.result.current.dirty).toBe(true)
  })
})

describe('useEntryEditor: conflicts', () => {
  it('a save conflict stops saving and keeps the local copy', async () => {
    const view = await renderEditor()
    fn.updateDraftFn.mockRejectedValueOnce(conflictError())
    type(view, 'Mine')
    await tick(3000)
    await tick()
    const state = view.result.current
    expect(state.conflict).toBe('save')
    expect(state.recoveredDraft).toEqual({ title: 'Mine', slug: 'hello-page' })
    expect(state.status).toBe('failed')
    expect(state.formError).toBeNull()
    expect(state.errorCount).toBe(0)

    // No further request while the conflict is open.
    type(view, 'Mine again')
    await tick(3000)
    await act(async () => {
      expect(await view.result.current.save()).toBe('failed')
    })
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
  })

  it('reload takes the latest server draft and keeps the copy on offer', async () => {
    const view = await renderEditor()
    fn.updateDraftFn.mockRejectedValueOnce(conflictError())
    type(view, 'Mine')
    await tick(3000)
    await tick()
    fn.getEntryFn.mockResolvedValue(
      record({
        draftData: { title: 'Theirs', slug: 'hello-page' },
        draftVersion: 5,
      }),
    )
    await act(async () => {
      await view.result.current.reloadServerDraft()
    })
    const state = view.result.current
    expect(state.conflict).toBeNull()
    expect(state.data.title).toBe('Theirs')
    expect(state.dirty).toBe(false)
    expect(state.status).toBe('idle')
    expect(state.recoveredDraft).toEqual({ title: 'Mine', slug: 'hello-page' })

    // Saving resumes against the new version.
    type(view, 'Theirs and mine')
    await tick(3000)
    await tick()
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(2)
    expect(fn.updateDraftFn.mock.calls[1][0].data.expectedVersion).toBe(5)
  })

  it('reapply after a conflict loads the server version and re-applies the edit', async () => {
    const view = await renderEditor()
    fn.updateDraftFn.mockRejectedValueOnce(conflictError())
    type(view, 'Mine')
    await tick(3000)
    await tick()
    fn.getEntryFn.mockResolvedValue(
      record({
        draftData: { title: 'Theirs', slug: 'hello-page' },
        draftVersion: 5,
      }),
    )
    await act(async () => {
      await view.result.current.reapplyRecoveredDraft()
    })
    const state = view.result.current
    expect(state.conflict).toBeNull()
    expect(state.data.title).toBe('Mine')
    expect(state.recoveredDraft).toBeNull()
    expect(state.dirty).toBe(true)
  })

  it('a conflict on Mark ready is an approval conflict', async () => {
    const view = await renderEditor()
    fn.publishEntryFn.mockRejectedValueOnce(conflictError())
    act(() => view.result.current.markReady())
    await tick()
    await tick()
    await tick()
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
    expect(fn.publishEntryFn.mock.calls[0][0].data).toEqual({
      id: 'entry-1',
      expectedVersion: 2,
    })
    expect(view.result.current.conflict).toBe('approval')
    expect(view.result.current.recoveredDraft).toBeNull()
  })
})

describe('useEntryEditor: adopting a server record', () => {
  it('restore hydrates the restored draft and reports skipped fields', async () => {
    const view = await renderEditor()
    const restored = record({
      draftData: { title: 'Old', slug: 'hello-page' },
      draftVersion: 3,
    })
    fn.restoreRevisionFn.mockResolvedValue({
      ...restored,
      skippedFields: [{ key: 'gone', label: 'Gone', reason: 'removed' }],
    })
    fn.getEntryFn.mockResolvedValue(restored)
    await act(async () => {
      await view.result.current.restore('rev-1')
    })
    expect(fn.restoreRevisionFn.mock.calls[0][0].data).toEqual({
      entryId: 'entry-1',
      revisionId: 'rev-1',
      expectedVersion: 1,
    })
    expect(view.result.current.data.title).toBe('Old')
    expect(view.result.current.dirty).toBe(false)
    expect(view.result.current.restoreSkippedFields).toHaveLength(1)
    // The next save uses the restored version.
    type(view, 'Newer')
    await tick(3000)
    await tick()
    expect(fn.updateDraftFn.mock.calls.at(-1)![0].data.expectedVersion).toBe(3)
  })

  it('discard (site content) takes the ready version and clears the copy', async () => {
    fn.updateGlobalDraftFn.mockImplementation(
      async ({ data }: { data: { data: object; expectedVersion: number } }) =>
        record({
          draftData: data.data,
          draftVersion: data.expectedVersion + 1,
        }),
    )
    const view = await renderEditor({
      globalKey: 'home',
      collectionKey: 'home',
    })
    type(view, 'Draft')
    await tick(500)
    const key = 'areca:draft:user-1:site-1:home:entry-1'
    expect(localStorage.getItem(key)).not.toBeNull()
    const ready = record({
      draftData: { title: 'Ready', slug: 'hello-page' },
      draftVersion: 7,
    })
    fn.discardGlobalDraftFn.mockResolvedValue(ready)
    fn.getEntryFn.mockResolvedValue(ready)
    await act(async () => {
      await view.result.current.discard()
    })
    expect(view.result.current.data.title).toBe('Ready')
    expect(view.result.current.dirty).toBe(false)
    expect(view.result.current.recoveredDraft).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
    type(view, 'After')
    await tick(3000)
    await tick()
    expect(
      fn.updateGlobalDraftFn.mock.calls.at(-1)![0].data.expectedVersion,
    ).toBe(7)
  })
})

describe('useEntryEditor: leaving', () => {
  it('saves before navigation and lets it through once saved', async () => {
    const view = await renderEditor()
    type(view, 'Leaving')
    let blocked: boolean | undefined
    await act(async () => {
      blocked = await blockerRef.options!.shouldBlockFn({
        current: { pathname: '/a' },
        next: { pathname: '/b' },
      })
    })
    expect(blocked).toBe(false)
    expect(fn.updateDraftFn).toHaveBeenCalledTimes(1)
    expect(view.result.current.dirty).toBe(false)
  })

  it('keeps the editor open when the save fails', async () => {
    const view = await renderEditor()
    fn.updateDraftFn.mockRejectedValueOnce(new Error('Network down'))
    type(view, 'Leaving')
    let blocked: boolean | undefined
    await act(async () => {
      blocked = await blockerRef.options!.shouldBlockFn({
        current: { pathname: '/a' },
        next: { pathname: '/b' },
      })
    })
    expect(blocked).toBe(true)
  })

  it('does not block a clean editor', async () => {
    await renderEditor()
    expect(
      await blockerRef.options!.shouldBlockFn({
        current: { pathname: '/a' },
        next: { pathname: '/b' },
      }),
    ).toBe(false)
    expect(fn.updateDraftFn).not.toHaveBeenCalled()
  })
})
