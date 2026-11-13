import { describe, expect, it, vi } from 'vitest'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { OVERVIEW_ENTRIES, queryKeys } from '#/lib/query-keys'
import { ME_QUERY_KEY } from '#/lib/me-query'

import {
  bulkQueryKeys,
  devEnvQueryKeys,
  entryQueryKeys,
  invalidateDevSync,
  invalidateQueryKeys,
  resetQueryKeys,
  writeQueryKeys,
} from './invalidate'

const ids = { devSiteId: 'dev', productionSiteId: 'prod' }
const keys = devEnvQueryKeys(ids)

describe('devEnvQueryKeys', () => {
  it('covers the dev site content, settings and languages', () => {
    expect(keys).toContainEqual(['collections', 'dev'])
    expect(keys).toContainEqual(['entry-counts', 'dev'])
    expect(keys).toContainEqual(['entries', 'dev'])
    expect(keys).toContainEqual(['globals', 'dev'])
    expect(keys).toContainEqual(['global', 'dev'])
    expect(keys).toContainEqual(['site', 'dev'])
    expect(keys).toContainEqual(['dev-sync', 'dev'])
  })

  it('covers the production content, settings, release and publishing queries', () => {
    expect(keys).toContainEqual(['collections', 'prod'])
    expect(keys).toContainEqual(['entry-counts', 'prod'])
    expect(keys).toContainEqual(['entries', 'prod'])
    expect(keys).toContainEqual(['globals', 'prod'])
    expect(keys).toContainEqual(['global', 'prod'])
    expect(keys).toContainEqual(['site', 'prod'])
    expect(keys).toContainEqual(['release-status', 'prod'])
    expect(keys).toContainEqual(['publications', 'prod'])
    expect(keys).toContainEqual(['build-jobs', 'prod'])
  })

  it('covers the dev env status, the push plan and the signed-in user', () => {
    expect(keys).toContainEqual(['dev-environment', 'prod'])
    expect(keys).toContainEqual(['push-plan', 'dev'])
    expect(keys).toContainEqual(ME_QUERY_KEY)
  })

  it('covers the go-live tray pending list of the production site', () => {
    expect(keys).toContainEqual(['golive-pending', 'prod'])
  })

  it('does not reach the entry family on its own', () => {
    expect(keys).not.toContainEqual(['entry'])
  })
})

describe('resetQueryKeys', () => {
  const reset = resetQueryKeys(ids)

  it('covers every key a reset changes, on both sites', () => {
    for (const key of keys) expect(reset).toContainEqual(key)
  })

  it('invalidates the whole entry family, since entries are keyed by id only', () => {
    expect(reset).toContainEqual(['entry'])
  })
})

describe('writeQueryKeys (push and copy)', () => {
  const write = writeQueryKeys({ ...ids, productionEntryIds: ['e1', 'e2'] })

  it('covers every key a push or copy changes, on both sites', () => {
    for (const key of keys) expect(write).toContainEqual(key)
  })

  it('invalidates the written production entries by id', () => {
    expect(write).toContainEqual(queryKeys.entry('e1'))
    expect(write).toContainEqual(queryKeys.entry('e2'))
  })

  it('does not invalidate the whole entry family', () => {
    expect(write).not.toContainEqual(['entry'])
  })

  it('has no entry keys when nothing was written', () => {
    const none = writeQueryKeys({ ...ids, productionEntryIds: [] })
    expect(none.some((key) => key[0] === 'entry')).toBe(false)
  })

  it('invalidates the whole entry family when a schema or language item was written', () => {
    const withSchema = writeQueryKeys({
      ...ids,
      productionEntryIds: ['e1'],
      wholeEntryFamily: true,
    })
    expect(withSchema).toContainEqual(['entry'])
    for (const key of keys) expect(withSchema).toContainEqual(key)
  })

  it('keeps the per-id entry keys when the family flag is off', () => {
    const perId = writeQueryKeys({
      ...ids,
      productionEntryIds: ['e1'],
      wholeEntryFamily: false,
    })
    expect(perId).toContainEqual(queryKeys.entry('e1'))
    expect(perId).not.toContainEqual(['entry'])
  })
})

describe('entryQueryKeys', () => {
  it('keys one entry cache per id', () => {
    expect(entryQueryKeys(['a', 'b'])).toEqual([
      ['entry', 'a'],
      ['entry', 'b'],
    ])
  })
})

describe('bulkQueryKeys', () => {
  it('covers the collection list, each touched entry and the dev sync status', () => {
    expect(
      bulkQueryKeys({
        siteId: 'dev',
        collectionKey: 'posts',
        entryIds: ['e1'],
      }),
    ).toEqual([
      ['entries', 'dev', 'posts'],
      ['entries', 'dev', OVERVIEW_ENTRIES],
      ['entry-counts', 'dev'],
      ['entry', 'e1'],
      ['dev-sync', 'dev'],
    ])
  })
})

describe('invalidateQueryKeys', () => {
  it('invalidates every key and refreshes the router', async () => {
    const calls: QueryKey[] = []
    const queryClient = {
      invalidateQueries: vi.fn(async (filter: { queryKey: QueryKey }) => {
        calls.push(filter.queryKey)
      }),
    } as unknown as QueryClient
    const router = { invalidate: vi.fn(async () => undefined) }

    await invalidateQueryKeys(queryClient, router, [['a'], ['b', 'c']])

    expect(calls).toEqual([['a'], ['b', 'c']])
    expect(router.invalidate).toHaveBeenCalledTimes(1)
  })

  it('refreshes the router for a bulk action', async () => {
    const invalidateQueries = vi.fn(async () => undefined)
    const queryClient = { invalidateQueries } as unknown as QueryClient
    const router = { invalidate: vi.fn(async () => undefined) }

    await invalidateQueryKeys(
      queryClient,
      router,
      bulkQueryKeys({ siteId: 'dev', collectionKey: 'posts', entryIds: [] }),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.devSync('dev'),
    })
    expect(router.invalidate).toHaveBeenCalledTimes(1)
  })

  it('invalidates the sync status of one site', async () => {
    const invalidateQueries = vi.fn(async () => undefined)
    const queryClient = { invalidateQueries } as unknown as QueryClient
    await invalidateDevSync(queryClient, 'dev')
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dev-sync', 'dev'],
    })
  })
})
