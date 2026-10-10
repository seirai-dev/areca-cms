import { describe, expect, it } from 'vitest'

import { currentAuditContext, withAuditContext } from './audit-context'

describe('audit context', () => {
  it('is undefined outside a context', () => {
    expect(currentAuditContext()).toBeUndefined()
  })

  it('exposes the meta inside the callback, including across awaits', async () => {
    const result = await withAuditContext(
      { via: 'mcp', mcpKeyName: 'Laptop' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return currentAuditContext()
      },
    )
    expect(result).toEqual({ via: 'mcp', mcpKeyName: 'Laptop' })
  })

  it('restores the outer context after the inner callback finishes', async () => {
    await withAuditContext({ via: 'mcp' }, async () => {
      await withAuditContext({ mcpKeyName: 'Inner' }, async () => {
        expect(currentAuditContext()).toEqual({
          via: 'mcp',
          mcpKeyName: 'Inner',
        })
      })
      expect(currentAuditContext()).toEqual({ via: 'mcp' })
    })
    expect(currentAuditContext()).toBeUndefined()
  })

  it('isolates concurrent contexts', async () => {
    const seen = await Promise.all(
      ['a', 'b'].map((name) =>
        withAuditContext({ mcpKeyName: name }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return currentAuditContext()?.mcpKeyName
        }),
      ),
    )
    expect(seen).toEqual(['a', 'b'])
  })

  it('propagates errors and clears the context', async () => {
    await expect(
      withAuditContext({ via: 'mcp' }, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(currentAuditContext()).toBeUndefined()
  })
})
