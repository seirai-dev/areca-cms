import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import type * as DbModule from '#/db'
import { hashToken } from '#/server/security/token-hash'

import { getInvitation, listInvitations } from './invitations.ts'

// Records what the invitation lookups select and filter by, without a database.
const calls = vi.hoisted(() => ({
  selected: [] as unknown[],
  conditions: [] as unknown[],
}))

vi.mock('#/db', async (importOriginal) => {
  // Keeps the real pool, which other modules read at import time.
  const actual = await importOriginal<typeof DbModule>()
  const chain: Record<string, unknown> = {}
  const done = async () => []
  Object.assign(chain, {
    from: () => chain,
    where: (condition: unknown) => {
      calls.conditions.push(condition)
      return chain
    },
    orderBy: done,
    limit: done,
    for: done,
  })
  return {
    ...actual,
    db: {
      select: (fields?: unknown) => {
        calls.selected.push(fields)
        return chain
      },
    },
  }
})

describe('invitation token storage', () => {
  it('lists invitations without the token or its hash', async () => {
    calls.selected = []
    await listInvitations('org-1')
    const fields = calls.selected[0] as Record<string, unknown>
    expect(Object.keys(fields)).not.toContain('token')
    expect(Object.keys(fields)).not.toContain('tokenHash')
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(['id', 'email', 'deliveryStatus']),
    )
  })

  it('looks an invitation up by the hash of the token it is given', async () => {
    calls.conditions = []
    await getInvitation('raw-invite-token')
    const bound = new PgDialect().sqlToQuery(calls.conditions[0] as SQL).params
    expect(bound).toContain(hashToken('raw-invite-token'))
    expect(bound).not.toContain('raw-invite-token')
  })
})
