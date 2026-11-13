import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAiBudget } from './budget'

const mocks = vi.hoisted(() => ({
  config: null as null | { apiKey: string; model: string },
  allowed: true,
  allowUserAction: vi.fn(),
}))

vi.mock('./settings', () => ({
  loadAiRuntimeConfig: async () => mocks.config,
}))
vi.mock('#/server/http/rate-limit.server', () => ({
  allowUserAction: (...args: unknown[]) => {
    mocks.allowUserAction(...args)
    return Promise.resolve(mocks.allowed)
  },
}))

describe('requireAiBudget', () => {
  beforeEach(() => {
    mocks.config = { apiKey: 'k', model: 'm' }
    mocks.allowed = true
    mocks.allowUserAction.mockClear()
  })

  it('refuses when AI is not set up, before spending the budget', async () => {
    mocks.config = null
    await expect(requireAiBudget('u1')).rejects.toMatchObject({
      code: 'not_configured',
    })
    expect(mocks.allowUserAction).not.toHaveBeenCalled()
  })

  it('refuses once the hourly budget is used up', async () => {
    mocks.allowed = false
    await expect(requireAiBudget('u1')).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('returns the settings and counts the call in the shared bucket', async () => {
    await expect(requireAiBudget('u1')).resolves.toEqual(mocks.config)
    expect(mocks.allowUserAction).toHaveBeenCalledWith('ai-seo', 'u1', {
      limit: 30,
      windowSeconds: 3600,
    })
  })
})
