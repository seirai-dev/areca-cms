import { createHash } from 'node:crypto'

/**
 * The identifier Better Auth stores for a verification value when
 * `verification.storeIdentifier` is `'hashed'`: base64url of its SHA-256.
 */
export function hashedVerificationIdentifier(identifier: string) {
  return createHash('sha256').update(identifier).digest('base64url')
}

/** Both forms a verification row may carry (plain rows predate hashing). */
export function verificationIdentifierForms(identifier: string) {
  return [identifier, hashedVerificationIdentifier(identifier)]
}
