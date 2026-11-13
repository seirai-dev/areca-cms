import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ME_QUERY_KEY, loadMe } from './me-query'

const getMeFn = vi.hoisted(() => vi.fn())
vi.mock('#/server/fn/me', () => ({ getMeFn }))

const signedIn = (id: string) => ({ user: { id } })

describe('loadMe', () => {
  beforeEach(() => getMeFn.mockReset())

  it('keeps cached data while the same user stays signed in', async () => {
    const queryClient = new QueryClient()
    getMeFn.mockResolvedValue(signedIn('admin'))
    await loadMe(queryClient)
    queryClient.setQueryData(['sites-overview'], ['admin site'])

    queryClient.removeQueries({ queryKey: ME_QUERY_KEY })
    await loadMe(queryClient)

    expect(queryClient.getQueryData(['sites-overview'])).toEqual(['admin site'])
  })

  it("drops the previous user's cached data when another user signs in", async () => {
    const queryClient = new QueryClient()
    getMeFn.mockResolvedValue(signedIn('admin'))
    await loadMe(queryClient)
    queryClient.setQueryData(['sites-overview'], ['admin site'])
    queryClient.setQueryData(['users'], ['everyone'])

    queryClient.removeQueries({ queryKey: ME_QUERY_KEY })
    getMeFn.mockResolvedValue(signedIn('editor'))
    const me = await loadMe(queryClient)

    expect(me).toEqual(signedIn('editor'))
    expect(queryClient.getQueryData(['sites-overview'])).toBeUndefined()
    expect(queryClient.getQueryData(['users'])).toBeUndefined()
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toEqual(signedIn('editor'))
  })

  it('drops cached data on sign-out', async () => {
    const queryClient = new QueryClient()
    getMeFn.mockResolvedValue(signedIn('admin'))
    await loadMe(queryClient)
    queryClient.setQueryData(['sites-overview'], ['admin site'])

    queryClient.removeQueries({ queryKey: ME_QUERY_KEY })
    getMeFn.mockResolvedValue(null)
    await loadMe(queryClient)

    expect(queryClient.getQueryData(['sites-overview'])).toBeUndefined()
  })
})
