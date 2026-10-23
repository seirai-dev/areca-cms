import { describe, expect, it } from 'vitest'

import {
  accessChange,
  accessSummary,
  addPicks,
  hasStagedChanges,
  isRoleChanged,
  removeRow,
  rowForServerError,
  setRole,
  stageFromMemberships,
  undoRemove,
} from './access-stage'
import type { StagedAccessRow } from './access-stage'

const saved = stageFromMemberships([
  {
    organizationId: 'nw',
    organizationName: 'Northwind',
    organizationSlug: 'northwind',
    role: 'editor',
    isOnlyOwner: false,
  },
  {
    organizationId: 'acme',
    organizationName: 'Acme',
    organizationSlug: 'acme',
    role: 'owner',
    isOnlyOwner: true,
  },
])

const byId = (rows: StagedAccessRow[], id: string) =>
  rows.find((row) => row.organizationId === id)

describe('stageFromMemberships', () => {
  it('starts with every saved membership unchanged, sorted by client name', () => {
    expect(saved.map((row) => row.name)).toEqual(['Acme', 'Northwind'])
    expect(accessChange(saved)).toEqual({ add: [], change: [], remove: [] })
    expect(hasStagedChanges(accessChange(saved))).toBe(false)
  })
})

describe('staged access diff', () => {
  it('turns picks, a role change and a removal into one payload', () => {
    let rows = addPicks(
      saved,
      [
        { organizationId: 'beta', name: 'Beta', slug: 'beta' },
        { organizationId: 'gamma', name: 'Gamma', slug: 'gamma' },
      ],
      'editor',
    )
    rows = setRole(rows, 'nw', 'owner')
    rows = removeRow(rows, 'acme')

    expect(accessChange(rows)).toEqual({
      add: [
        { organizationId: 'beta', role: 'editor' },
        { organizationId: 'gamma', role: 'editor' },
      ],
      change: [{ organizationId: 'nw', role: 'owner' }],
      remove: ['acme'],
    })
    expect(accessSummary(accessChange(rows))).toEqual({
      added: 2,
      changed: 1,
      removed: 1,
    })
  })

  it('lets each picked client carry its own role', () => {
    let rows = addPicks(
      saved,
      [{ organizationId: 'beta', name: 'Beta', slug: 'beta' }],
      'editor',
    )
    rows = setRole(rows, 'beta', 'owner')
    expect(accessChange(rows).add).toEqual([
      { organizationId: 'beta', role: 'owner' },
    ])
  })

  it('drops a picked client that is removed again before saving', () => {
    let rows = addPicks(
      saved,
      [{ organizationId: 'beta', name: 'Beta', slug: 'beta' }],
      'editor',
    )
    rows = removeRow(rows, 'beta')
    expect(byId(rows, 'beta')).toBeUndefined()
    expect(hasStagedChanges(accessChange(rows))).toBe(false)
  })

  it('strikes a saved client through and restores it on undo', () => {
    let rows = removeRow(saved, 'acme')
    expect(byId(rows, 'acme')?.removed).toBe(true)
    expect(accessChange(rows).remove).toEqual(['acme'])
    rows = undoRemove(rows, 'acme')
    expect(accessChange(rows)).toEqual({ add: [], change: [], remove: [] })
  })

  it('brings back a removed saved client when it is picked again, with its saved role', () => {
    let rows = removeRow(saved, 'acme')
    rows = addPicks(
      rows,
      [{ organizationId: 'acme', name: 'Acme', slug: 'acme' }],
      'editor',
    )
    expect(byId(rows, 'acme')).toMatchObject({ removed: false, role: 'owner' })
    expect(accessChange(rows)).toEqual({ add: [], change: [], remove: [] })
  })

  it('does not count a role changed back to the saved role', () => {
    let rows = setRole(saved, 'nw', 'owner')
    expect(isRoleChanged(byId(rows, 'nw')!)).toBe(true)
    rows = setRole(rows, 'nw', 'editor')
    expect(isRoleChanged(byId(rows, 'nw')!)).toBe(false)
    expect(accessChange(rows).change).toEqual([])
  })

  it('does not add a client that is already in the list', () => {
    const rows = addPicks(
      saved,
      [{ organizationId: 'nw', name: 'Northwind', slug: 'northwind' }],
      'owner',
    )
    expect(rows).toHaveLength(2)
    expect(byId(rows, 'nw')?.role).toBe('editor')
  })
})

describe('rowForServerError', () => {
  it('finds the row whose client the server names', () => {
    expect(
      rowForServerError(
        saved,
        'Cannot demote the last owner of Acme. Make someone else an owner first.',
      ),
    ).toBe('acme')
  })

  it('returns null when the message names no staged client', () => {
    expect(rowForServerError(saved, 'Something else went wrong')).toBeNull()
  })
})
