import { describe, expect, it } from 'vitest'
import { siteContent } from './content.ts'

describe('siteContent', () => {
  it('defines the demo site key', () => {
    expect(siteContent.siteKey).toBe('demo')
  })
})
