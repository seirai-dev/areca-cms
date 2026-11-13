import { describe, expect, it } from 'vitest'

import { getContext } from './root-provider'

describe('query freshness', () => {
  it('treats results as stale by default, so opening a screen refetches', () => {
    const { queryClient } = getContext()
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBeUndefined()
  })
})
