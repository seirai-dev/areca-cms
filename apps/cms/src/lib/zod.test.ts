import { describe, expect, it } from 'vitest'
import { z } from '#/lib/zod'

describe('app Zod configuration', () => {
  it('stops at the array limit before collecting invalid item errors', () => {
    const schema = z.array(z.string().email()).max(2)

    const result = schema.safeParse(['bad', 'also bad', 'too many'])

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1)
      expect(result.error.issues[0]?.code).toBe('too_big')
    }
  })
})
