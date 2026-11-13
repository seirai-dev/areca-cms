import { describe, expect, it } from 'vitest'

import { seededCloudflareFields } from './cloudflare-card-form'

describe('seededCloudflareFields', () => {
  it('shows the saved account ID and never a token', () => {
    expect(
      seededCloudflareFields({ accountId: '0123456789abcdef0123456789abcdef' }),
    ).toEqual({ accountId: '0123456789abcdef0123456789abcdef', apiToken: '' })
  })

  it('empties both fields when nothing is saved or the connection was removed', () => {
    expect(seededCloudflareFields(null)).toEqual({
      accountId: '',
      apiToken: '',
    })
    expect(seededCloudflareFields(undefined)).toEqual({
      accountId: '',
      apiToken: '',
    })
    expect(seededCloudflareFields({ accountId: null })).toEqual({
      accountId: '',
      apiToken: '',
    })
  })
})
