import { describe, expect, it } from 'vitest'

import {
  ALL_CLIENTS,
  DEFAULT_PEOPLE_FILTERS,
  countByStatus,
  filterAccounts,
  filterInvitations,
  hasActiveFilters,
  parsePeopleFilters,
} from './people-list'
import type { PeopleAccount, PeopleInvitation } from './people-list'

const accounts: PeopleAccount[] = [
  {
    id: 'admin',
    name: 'Agency Admin',
    email: 'admin@areca.local',
    status: 'active',
    isAgencyAdmin: true,
    twoFactorEnabled: true,
    memberships: [],
  },
  {
    id: 'owner',
    name: 'Acme Owner',
    email: 'owner@acme.local',
    status: 'active',
    isAgencyAdmin: false,
    twoFactorEnabled: false,
    memberships: [{ organizationId: 'acme', role: 'owner' }],
  },
  {
    id: 'editor',
    name: 'Blocked Editor',
    email: 'editor@northwind.local',
    status: 'blocked',
    isAgencyAdmin: false,
    twoFactorEnabled: true,
    memberships: [
      { organizationId: 'acme', role: 'editor' },
      { organizationId: 'nw', role: 'owner' },
    ],
  },
]

const invitations: PeopleInvitation[] = [
  { id: 'i1', email: 'new@acme.local', organizationId: 'acme', role: 'editor' },
  { id: 'i2', email: 'new@nw.local', organizationId: 'nw', role: 'owner' },
]

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id)
const filters = (
  patch: Partial<typeof DEFAULT_PEOPLE_FILTERS> = {},
): typeof DEFAULT_PEOPLE_FILTERS => ({ ...DEFAULT_PEOPLE_FILTERS, ...patch })

describe('filterAccounts', () => {
  it('returns everyone by default', () => {
    expect(ids(filterAccounts(accounts, filters()))).toEqual([
      'admin',
      'owner',
      'editor',
    ])
  })

  it('searches name and email, ignoring case and spaces around the term', () => {
    expect(
      ids(filterAccounts(accounts, filters({ search: '  ACME.local ' }))),
    ).toEqual(['owner'])
  })

  it('filters by status', () => {
    expect(
      ids(filterAccounts(accounts, filters({ status: 'active' }))),
    ).toEqual(['admin', 'owner'])
    expect(
      ids(filterAccounts(accounts, filters({ status: 'blocked' }))),
    ).toEqual(['editor'])
    expect(
      ids(filterAccounts(accounts, filters({ status: 'two-factor-off' }))),
    ).toEqual(['owner'])
  })

  it('hides every account under the Invited filter', () => {
    expect(filterAccounts(accounts, filters({ status: 'invited' }))).toEqual([])
  })

  it('filters agency admins and combines role with the client menu', () => {
    expect(
      ids(filterAccounts(accounts, filters({ role: 'agency-admin' }))),
    ).toEqual(['admin'])
    expect(ids(filterAccounts(accounts, filters({ role: 'owner' })))).toEqual([
      'owner',
      'editor',
    ])
    expect(
      ids(
        filterAccounts(accounts, filters({ role: 'owner', clientId: 'acme' })),
      ),
    ).toEqual(['owner'])
    expect(
      ids(
        filterAccounts(accounts, filters({ role: 'editor', clientId: 'acme' })),
      ),
    ).toEqual(['editor'])
    expect(ids(filterAccounts(accounts, filters({ clientId: 'nw' })))).toEqual([
      'editor',
    ])
  })
})

describe('filterInvitations', () => {
  it('shows invitations under All and Invited only', () => {
    expect(ids(filterInvitations(invitations, filters()))).toEqual(['i1', 'i2'])
    expect(
      ids(filterInvitations(invitations, filters({ status: 'invited' }))),
    ).toEqual(['i1', 'i2'])
    expect(
      filterInvitations(invitations, filters({ status: 'active' })),
    ).toEqual([])
  })

  it('hides invitations for the agency-admin filter and matches the role and client', () => {
    expect(
      filterInvitations(invitations, filters({ role: 'agency-admin' })),
    ).toEqual([])
    expect(
      ids(filterInvitations(invitations, filters({ role: 'owner' }))),
    ).toEqual(['i2'])
    expect(
      ids(filterInvitations(invitations, filters({ clientId: 'acme' }))),
    ).toEqual(['i1'])
    expect(
      ids(filterInvitations(invitations, filters({ search: 'nw.local' }))),
    ).toEqual(['i2'])
  })
})

describe('countByStatus', () => {
  it('counts every pill from the unfiltered data', () => {
    expect(countByStatus(accounts, invitations)).toEqual({
      all: 5,
      active: 2,
      blocked: 1,
      invited: 2,
      'two-factor-off': 1,
    })
  })

  it('counts nothing when there are no people', () => {
    expect(countByStatus([], [])).toEqual({
      all: 0,
      active: 0,
      blocked: 0,
      invited: 0,
      'two-factor-off': 0,
    })
  })
})

describe('parsePeopleFilters', () => {
  it('reads valid URL values and falls back to defaults for anything else', () => {
    expect(
      parsePeopleFilters({
        q: 'jane',
        status: 'blocked',
        role: 'owner',
        client: 'acme',
      }),
    ).toEqual({
      search: 'jane',
      status: 'blocked',
      role: 'owner',
      clientId: 'acme',
    })
    expect(
      parsePeopleFilters({ status: 'everyone', role: 3, client: '' }),
    ).toEqual(DEFAULT_PEOPLE_FILTERS)
    expect(parsePeopleFilters({}).clientId).toBe(ALL_CLIENTS)
  })
})

describe('hasActiveFilters', () => {
  it('is false for the defaults and true when any filter narrows the list', () => {
    expect(hasActiveFilters(DEFAULT_PEOPLE_FILTERS)).toBe(false)
    expect(hasActiveFilters(filters({ search: '   ' }))).toBe(false)
    expect(hasActiveFilters(filters({ search: 'a' }))).toBe(true)
    expect(hasActiveFilters(filters({ status: 'blocked' }))).toBe(true)
    expect(hasActiveFilters(filters({ role: 'editor' }))).toBe(true)
    expect(hasActiveFilters(filters({ clientId: 'acme' }))).toBe(true)
  })
})
