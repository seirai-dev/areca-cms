import { describe, expect, it } from 'vitest'

import { resolveWorkspace } from './resolve-workspace'

const site = (id: string) => ({
  id,
  name: id,
  slug: id,
  organizationId: 'org',
  organizationName: 'Org',
  productionUrl: 'https://example.com',
  languages: null,
  environment: 'production' as const,
  parentSiteId: null,
})

const user = (isAgencyAdmin: boolean) => ({
  id: 'u',
  name: 'U',
  email: 'u@example.com',
  isAgencyAdmin,
  twoFactorEnabled: false,
  emailVerified: true,
  locale: 'en' as const,
})

describe('resolveWorkspace', () => {
  it('prefers the last-used site when it is still accessible', () => {
    expect(
      resolveWorkspace(
        { user: user(false), sites: [site('a'), site('b')] },
        'b',
      ),
    ).toEqual({ kind: 'site', siteId: 'b' })
  })

  it('ignores a stale cookie', () => {
    expect(
      resolveWorkspace(
        { user: user(false), sites: [site('a'), site('b')] },
        'gone',
      ),
    ).toEqual({ kind: 'picker' })
  })

  it('opens the only site', () => {
    expect(
      resolveWorkspace({ user: user(true), sites: [site('a')] }, null),
    ).toEqual({
      kind: 'site',
      siteId: 'a',
    })
  })

  it('sends admins with several sites to the agency workspace', () => {
    expect(
      resolveWorkspace(
        { user: user(true), sites: [site('a'), site('b')] },
        null,
      ),
    ).toEqual({ kind: 'agency' })
    expect(resolveWorkspace({ user: user(true), sites: [] }, null)).toEqual({
      kind: 'agency',
    })
  })

  it('falls back to the picker for members without a single site', () => {
    expect(resolveWorkspace({ user: user(false), sites: [] }, null)).toEqual({
      kind: 'picker',
    })
  })
})
