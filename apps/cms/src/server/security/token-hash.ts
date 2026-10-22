import { createHash } from 'node:crypto'

/**
 * SHA-256 (hex) of a random secret token: the form stored in the database for
 * site tokens, MCP keys and invitation links. The token itself is shown once
 * and never kept, so a database read does not reveal a usable secret. Random
 * 256-bit tokens need no salt or slow hash.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
