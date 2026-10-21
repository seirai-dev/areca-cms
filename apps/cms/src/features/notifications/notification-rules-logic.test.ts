import { describe, expect, it } from 'vitest'

import type {
  MatrixCell,
  MyNotifications,
  RulesMatrix,
} from '#/lib/notifications'

import {
  applyAgencyRuleChange,
  applyPreferenceChange,
  applyRuleChange,
  findCell,
  lockChange,
  switchChange,
} from './notification-rules-logic'

const cell = (overrides: Partial<MatrixCell> = {}): MatrixCell => ({
  enabled: true,
  locked: false,
  overridden: false,
  lockedAbove: false,
  ...overrides,
})

const matrix: RulesMatrix = {
  rows: [
    {
      event: 'release.live',
      cells: { owner: cell(), editor: cell({ enabled: false }) },
    },
    {
      event: 'release.failed',
      cells: { owner: cell({ locked: true, overridden: true }) },
    },
  ],
}

describe('applyRuleChange', () => {
  it('sets only the targeted cell and marks it overridden', () => {
    const next = applyRuleChange(matrix, {
      event: 'release.live',
      role: 'editor',
      enabled: true,
      locked: false,
    })
    expect(findCell(next, 'release.live', 'editor')).toEqual(
      cell({ enabled: true, overridden: true }),
    )
    expect(findCell(next, 'release.live', 'owner')).toBe(
      findCell(matrix, 'release.live', 'owner'),
    )
    expect(next).not.toBe(matrix)
  })

  it('forces a locked cell on', () => {
    const next = applyRuleChange(matrix, {
      event: 'release.live',
      role: 'owner',
      enabled: false,
      locked: true,
    })
    expect(findCell(next, 'release.live', 'owner')).toEqual(
      cell({ enabled: true, locked: true, overridden: true }),
    )
  })

  it('clears the override and keeps the shown value until the server answers', () => {
    const next = applyRuleChange(matrix, {
      event: 'release.failed',
      role: 'owner',
      clear: true,
    })
    expect(findCell(next, 'release.failed', 'owner')).toEqual(
      cell({ locked: true, overridden: false }),
    )
  })

  it('ignores unknown events and roles', () => {
    const next = applyRuleChange(matrix, {
      event: 'rollback.live',
      role: 'owner',
      enabled: true,
      locked: false,
    })
    expect(next.rows).toEqual(matrix.rows)
  })
})

describe('applyAgencyRuleChange', () => {
  const data = {
    clients: matrix,
    agency: {
      rows: [
        {
          event: 'agency.release.failed' as const,
          cells: { agency: cell() },
        },
      ],
    },
  }

  it('routes the agency role to the agency matrix', () => {
    const next = applyAgencyRuleChange(data, {
      event: 'agency.release.failed',
      role: 'agency',
      enabled: false,
      locked: false,
    })
    expect(
      findCell(next.agency, 'agency.release.failed', 'agency')?.enabled,
    ).toBe(false)
    expect(next.clients).toBe(data.clients)
  })

  it('routes owner and editor to the clients matrix', () => {
    const next = applyAgencyRuleChange(data, {
      event: 'release.live',
      role: 'editor',
      enabled: true,
      locked: true,
    })
    expect(findCell(next.clients, 'release.live', 'editor')).toEqual(
      cell({ enabled: true, locked: true, overridden: true }),
    )
    expect(next.agency).toBe(data.agency)
  })
})

describe('switchChange and lockChange', () => {
  it('keeps the lock when the switch moves', () => {
    expect(switchChange(cell({ locked: false }), false)).toEqual({
      enabled: false,
      locked: false,
    })
  })

  it('locking turns the email on', () => {
    expect(lockChange(cell({ enabled: false, locked: false }))).toEqual({
      enabled: true,
      locked: true,
    })
  })

  it('unlocking keeps the email on', () => {
    expect(lockChange(cell({ enabled: true, locked: true }))).toEqual({
      enabled: true,
      locked: false,
    })
  })
})

describe('applyPreferenceChange', () => {
  const data: MyNotifications = {
    emailVerified: true,
    mailConfigured: true,
    agencyName: 'Areca',
    orgs: [
      {
        organizationId: 'org-1',
        orgName: 'Acme',
        role: 'owner',
        events: [
          { event: 'release.live', enabled: true, lockedBy: null },
          { event: 'release.failed', enabled: true, lockedBy: 'agency' },
        ],
      },
      {
        organizationId: 'org-2',
        orgName: 'Globex',
        role: 'editor',
        events: [{ event: 'release.live', enabled: true, lockedBy: null }],
      },
    ],
    agency: {
      events: [
        { event: 'agency.release.failed', enabled: true, lockedBy: null },
      ],
    },
  }

  it('flips one switch in one organization', () => {
    const next = applyPreferenceChange(data, {
      organizationId: 'org-1',
      event: 'release.live',
      enabled: false,
    })
    expect(next.orgs[0].events[0]).toEqual({
      event: 'release.live',
      enabled: false,
      lockedBy: null,
    })
    expect(next.orgs[1]).toBe(data.orgs[1])
  })

  it('never flips a locked row', () => {
    const next = applyPreferenceChange(data, {
      organizationId: 'org-1',
      event: 'release.failed',
      enabled: false,
    })
    expect(next.orgs[0].events[1].enabled).toBe(true)
  })

  it('flips agency alerts when the organization is null', () => {
    const next = applyPreferenceChange(data, {
      organizationId: null,
      event: 'agency.release.failed',
      enabled: false,
    })
    expect(next.agency?.events[0].enabled).toBe(false)
  })

  it('leaves the data alone when there are no agency alerts', () => {
    const next = applyPreferenceChange(
      { ...data, agency: null },
      { organizationId: null, event: 'agency.release.failed', enabled: false },
    )
    expect(next.agency).toBeNull()
  })
})
