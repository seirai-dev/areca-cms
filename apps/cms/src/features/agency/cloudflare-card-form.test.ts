import { describe, expect, it } from 'vitest'

import type { CloudflareFormEvent } from './cloudflare-card-form'
import { nextCloudflareFormFields } from './cloudflare-card-form'

const typed = {
  accountId: 'ffffffffffffffffffffffffffffffff',
  apiToken: 'cfut_pasted',
}
const saved = { accountId: '0123456789abcdef0123456789abcdef' }

function next(
  event: CloudflareFormEvent,
  overrides: Partial<Parameters<typeof nextCloudflareFormFields>[0]> = {},
) {
  return nextCloudflareFormFields({
    previousOrganizationId: 'org-a',
    organizationId: 'org-a',
    event,
    current: typed,
    saved,
    ...overrides,
  })
}

describe('nextCloudflareFormFields', () => {
  it('seeds the account ID from the saved connection on first load, token empty', () => {
    expect(
      next('load', {
        previousOrganizationId: null,
        current: { accountId: '', apiToken: '' },
      }),
    ).toEqual({ accountId: saved.accountId, apiToken: '' })
  })

  it('reseeds when the organization changes, dropping the other client’s edits', () => {
    expect(
      next('org-change', {
        previousOrganizationId: 'org-b',
        organizationId: 'org-a',
      }),
    ).toEqual({ accountId: saved.accountId, apiToken: '' })
  })

  it('after a save, shows the saved account ID and clears the token', () => {
    expect(next('saved')).toEqual({ accountId: saved.accountId, apiToken: '' })
  })

  it('after a remove, clears both fields', () => {
    expect(next('removed', { saved: null })).toEqual({
      accountId: '',
      apiToken: '',
    })
  })

  it('a background refresh keeps unsaved edits', () => {
    expect(next('refresh')).toBe(typed)
  })

  it('verify keeps unsaved edits', () => {
    expect(next('verified')).toBe(typed)
  })

  it('a refresh for a different organization than the form was seeded for reseeds', () => {
    expect(
      next('refresh', {
        previousOrganizationId: 'org-b',
        organizationId: 'org-a',
      }),
    ).toEqual({ accountId: saved.accountId, apiToken: '' })
  })

  it('seeds an empty account ID when there is no saved status', () => {
    expect(next('load', { saved: null, previousOrganizationId: null })).toEqual(
      {
        accountId: '',
        apiToken: '',
      },
    )
    expect(next('saved', { saved: undefined })).toEqual({
      accountId: '',
      apiToken: '',
    })
  })

  it('never keeps a typed token across a seeding event', () => {
    for (const event of ['load', 'org-change', 'saved', 'removed'] as const) {
      expect(next(event, { previousOrganizationId: 'org-b' }).apiToken).toBe('')
    }
  })
})
