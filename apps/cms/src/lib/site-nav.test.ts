import { describe, expect, it } from 'vitest'

import { nestDevEnvironments } from './site-nav'
import type { MeSite } from './site-nav'

function site(partial: Partial<MeSite> & Pick<MeSite, 'id'>): MeSite {
  return {
    name: partial.id,
    slug: partial.id,
    organizationId: 'org',
    organizationName: 'Acme',
    productionUrl: 'https://example.com',
    previewUrl: null,
    languages: null,
    environment: 'production',
    parentSiteId: null,
    ...partial,
  }
}

describe('nestDevEnvironments', () => {
  it('moves each development environment under its production site', () => {
    const sites = [
      site({ id: 'a' }),
      site({ id: 'a-dev', environment: 'development', parentSiteId: 'a' }),
      site({ id: 'b' }),
    ]
    const { topLevel, devByParent } = nestDevEnvironments(sites)
    expect(topLevel.map((item) => item.id)).toEqual(['a', 'b'])
    expect(devByParent.get('a')?.id).toBe('a-dev')
    expect(devByParent.has('b')).toBe(false)
  })

  it('keeps a development environment at the top level when its production site is missing', () => {
    const sites = [
      site({
        id: 'orphan-dev',
        environment: 'development',
        parentSiteId: 'gone',
      }),
    ]
    const { topLevel, devByParent } = nestDevEnvironments(sites)
    expect(topLevel.map((item) => item.id)).toEqual(['orphan-dev'])
    expect(devByParent.size).toBe(0)
  })
})
