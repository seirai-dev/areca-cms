import { describe, expect, it } from 'vitest'
import { providerRequest } from './provider-request'

describe('provider sign-in requests', () => {
  it('surfaces an immediate provider error and allows a subsequent retry', async () => {
    await expect(
      providerRequest(async () => ({
        error: { message: 'Provider unavailable' },
      })),
    ).rejects.toThrow('Provider unavailable')
    await expect(
      providerRequest(async () => ({ error: null })),
    ).resolves.toBeUndefined()
  })
  it('surfaces a network failure', async () => {
    await expect(
      providerRequest(async () => {
        throw new Error('Offline')
      }),
    ).rejects.toThrow('Offline')
  })
})
