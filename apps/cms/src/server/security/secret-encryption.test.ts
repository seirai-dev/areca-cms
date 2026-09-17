import { describe, expect, it } from 'vitest'

import { decryptSecret, encryptSecret } from './secret-encryption'

const key = Buffer.alloc(32, 1).toString('base64')
const otherKey = Buffer.alloc(32, 2).toString('base64')

describe('secret encryption', () => {
  it('round-trips with authenticated organization context', () => {
    const encrypted = encryptSecret('dokploy-secret', key, 'org-1')

    expect(encrypted).not.toContain('dokploy-secret')
    expect(decryptSecret(encrypted, key, 'org-1')).toBe('dokploy-secret')
    expect(() => decryptSecret(encrypted, key, 'org-2')).toThrow(/decrypt/)
    expect(() => decryptSecret(encrypted, otherKey, 'org-1')).toThrow(/decrypt/)
  })

  it('requires an exact base64-encoded 32-byte key', () => {
    expect(() => encryptSecret('secret', 'not-a-key', 'org-1')).toThrow(
      /base64-encoded 32-byte key/,
    )
  })
})
