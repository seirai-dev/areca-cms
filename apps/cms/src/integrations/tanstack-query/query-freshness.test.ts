import { describe, expect, it } from 'vitest'

import {
  buildJobQuery,
  jobsQuery,
  publicationsQuery,
} from '#/features/golive/queries'

import { QUERY_STALE_MS, getContext } from './root-provider'

describe('query freshness', () => {
  it('keeps query results fresh for 30 seconds by default', () => {
    const { queryClient } = getContext()
    expect(QUERY_STALE_MS).toBe(30_000)
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000)
  })

  it('always refetches live build state when it mounts', () => {
    expect(jobsQuery('site').staleTime).toBe(0)
    expect(publicationsQuery('site', 1).staleTime).toBe(0)
    expect(buildJobQuery('job').staleTime).toBe(0)
  })
})
