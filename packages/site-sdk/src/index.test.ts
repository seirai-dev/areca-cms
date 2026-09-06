import { describe, expect, it } from 'vitest'
import { defineSiteContent } from './index.js'

describe('defineSiteContent', () => {
  it('returns the config as-is', () => {
    const config = {
      siteKey: 'demo',
      collections: {},
    }

    expect(defineSiteContent(config)).toBe(config)
  })
})
