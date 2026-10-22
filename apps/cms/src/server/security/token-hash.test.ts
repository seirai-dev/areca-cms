import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { hashToken } from './token-hash.ts'

const migration = new URL(
  '../../../drizzle/0027_hash_invitation_tokens.sql',
  import.meta.url,
)

describe('hashToken', () => {
  it('is the SHA-256 of the UTF-8 token, as lowercase hex', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is what Node computes for any token', () => {
    const token = 'invite-τοκεν-42'
    expect(hashToken(token)).toBe(
      createHash('sha256').update(Buffer.from(token, 'utf8')).digest('hex'),
    )
  })
})

describe('migration 0027 hashes stored invitation tokens with the same encoding', () => {
  const sql = readFileSync(migration, 'utf8')

  it('applies SHA-256 to the UTF-8 bytes and encodes them as hex', () => {
    expect(sql).toContain(
      `UPDATE "invitation" SET "token_hash" = encode(sha256(convert_to("token_hash", 'UTF8')), 'hex');`,
    )
  })

  it('renames the column before hashing, so the hashed value is the token', () => {
    const rename = sql.indexOf('RENAME COLUMN "token" TO "token_hash"')
    const update = sql.indexOf('UPDATE "invitation"')
    expect(rename).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(rename)
  })
})
