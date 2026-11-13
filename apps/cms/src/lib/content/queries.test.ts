import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from './query-keys'

const fns = vi.hoisted(() => ({
  getEntryFn: vi.fn(),
  getPreviewUrlFn: vi.fn(),
  getAiAvailabilityFn: vi.fn(),
}))

vi.mock('#/server/fn/content', () => ({
  getEntryFn: fns.getEntryFn,
  getPreviewUrlFn: fns.getPreviewUrlFn,
  listCollectionsFn: vi.fn(),
  listEntryCountsFn: vi.fn(),
  listRecentEntriesFn: vi.fn(),
}))
vi.mock('#/server/fn/ai', () => ({
  getAiAvailabilityFn: fns.getAiAvailabilityFn,
}))

const { Route } =
  await import('#/routes/_app/sites/$siteId/c/$collectionKey/$entryId')

type Loader = (args: {
  context: { queryClient: QueryClient; site: { id: string } }
  params: { entryId: string; collectionKey: string }
  preload: boolean
}) => void

async function runLoader(queryClient: QueryClient, preload: boolean) {
  ;(Route.options.loader as unknown as Loader)({
    context: { queryClient, site: { id: 'site_1' } },
    params: { entryId: 'entry_1', collectionKey: 'posts' },
    preload,
  })
  await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editor route loader', () => {
  beforeEach(() => {
    // The loader prefetches in the browser only (lib/route-prefetch.ts).
    vi.stubGlobal('window', globalThis)
    vi.clearAllMocks()
    fns.getEntryFn.mockResolvedValue({ id: 'entry_1', slug: 'hello' })
    fns.getPreviewUrlFn.mockResolvedValue({ url: 'https://site/preview' })
    fns.getAiAvailabilityFn.mockResolvedValue({ enabled: false })
  })

  it('loads the entry, then its preview URL, with the keys the editor reads', async () => {
    const queryClient = new QueryClient()
    await runLoader(queryClient, false)
    expect(fns.getEntryFn).toHaveBeenCalledWith({ data: { id: 'entry_1' } })
    expect(queryClient.getQueryData(queryKeys.entry('entry_1'))).toEqual({
      id: 'entry_1',
      slug: 'hello',
    })
    expect(
      queryClient.getQueryData(
        queryKeys.previewUrl('site_1', 'posts', 'hello'),
      ),
    ).toEqual({ url: 'https://site/preview' })
    expect(queryClient.getQueryData(queryKeys.aiAvailability())).toEqual({
      enabled: false,
    })
  })

  it('loads only the entry on hover, and reuses a fresh copy', async () => {
    const queryClient = new QueryClient()
    await runLoader(queryClient, true)
    expect(fns.getEntryFn).toHaveBeenCalledTimes(1)
    expect(fns.getPreviewUrlFn).not.toHaveBeenCalled()
    expect(fns.getAiAvailabilityFn).not.toHaveBeenCalled()
    await runLoader(queryClient, false)
    expect(fns.getEntryFn).toHaveBeenCalledTimes(1)
    expect(fns.getPreviewUrlFn).toHaveBeenCalledTimes(1)
  })
})

describe('editor route loader on the server', () => {
  it('starts nothing, so the HTML shows the loading state as before', async () => {
    vi.clearAllMocks()
    const queryClient = new QueryClient()
    await runLoader(queryClient, false)
    expect(fns.getEntryFn).not.toHaveBeenCalled()
  })
})
