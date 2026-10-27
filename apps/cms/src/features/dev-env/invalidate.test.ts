import { describe, expect, it, vi } from 'vitest'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { ME_QUERY_KEY } from '#/lib/me-query'

import {
  devEnvQueryKeys,
  invalidateDevSync,
  invalidateQueryKeys,
} from './invalidate'

const keys = devEnvQueryKeys({ devSiteId: 'dev', productionSiteId: 'prod' })

describe('devEnvQueryKeys', () => {
  it('covers the dev site content, settings and languages', () => {
    expect(keys).toContainEqual(['collections', 'dev'])
    expect(keys).toContainEqual(['entries', 'dev'])
    expect(keys).toContainEqual(['globals', 'dev'])
    expect(keys).toContainEqual(['site', 'dev'])
    expect(keys).toContainEqual(['dev-sync', 'dev'])
  })

  it('covers the production content, release and publishing queries', () => {
    expect(keys).toContainEqual(['collections', 'prod'])
    expect(keys).toContainEqual(['entries', 'prod'])
    expect(keys).toContainEqual(['globals', 'prod'])
    expect(keys).toContainEqual(['release-status', 'prod'])
    expect(keys).toContainEqual(['publications', 'prod'])
    expect(keys).toContainEqual(['build-jobs', 'prod'])
  })

  it('covers the dev env status, the push plan and the signed-in user', () => {
    expect(keys).toContainEqual(['dev-environment', 'prod'])
    expect(keys).toContainEqual(['push-plan', 'dev'])
    expect(keys).toContainEqual(ME_QUERY_KEY)
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

  it('invalidates the sync status of one site', async () => {
    const invalidateQueries = vi.fn(async () => undefined)
    const queryClient = { invalidateQueries } as unknown as QueryClient
    await invalidateDevSync(queryClient, 'dev')
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dev-sync', 'dev'],
    })
  })
})
