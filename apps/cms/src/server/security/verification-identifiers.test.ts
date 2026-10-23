import { describe, expect, it } from 'vitest'

import {
  hashedVerificationIdentifier,
  verificationIdentifierForms,
} from './verification-identifiers.ts'

// Expected value taken from Better Auth's own `processIdentifier(id, 'hashed')`.
describe('hashedVerificationIdentifier', () => {
  it('matches the identifier Better Auth stores', () => {
    expect(hashedVerificationIdentifier('reset-password:abcDEF123')).toBe(
      'cJkYezUBNfSAqQPKULKFGKAUNcsxG8MkJF3FLGrCbzM',
    )
  })
})

describe('verificationIdentifierForms', () => {
  it('lists the plain identifier and its hashed form', () => {
    expect(verificationIdentifierForms('reset-password:abcDEF123')).toEqual([
      'reset-password:abcDEF123',
      'cJkYezUBNfSAqQPKULKFGKAUNcsxG8MkJF3FLGrCbzM',
    ])
  })
})
