import { describe, expect, it } from 'vitest'

import { filterAccounts } from './agency-people-screen'
import { clientInitials } from './queries'

const accounts = [
  {
    id: '1',
    name: 'Agency Admin',
    email: 'admin@areca.local',
    isAgencyAdmin: true,
    createdAt: new Date(),
    memberships: [],
  },
  {
    id: '2',
    name: 'Acme Owner',
    email: 'owner@acme.local',
    isAgencyAdmin: false,
    createdAt: new Date(),
    memberships: [
      {
        organizationId: 'acme',
        organizationName: 'Acme',
        role: 'owner' as const,
      },
    ],
  },
  {
    id: '3',
    name: 'Mixed Person',
    email: 'mixed@example.com',
    isAgencyAdmin: false,
    createdAt: new Date(),
    memberships: [
      {
        organizationId: 'acme',
        organizationName: 'Acme',
        role: 'editor' as const,
      },
      {
        organizationId: 'nw',
        organizationName: 'Northwind',
        role: 'owner' as const,
      },
    ],
  },
]

const ids = (rows: typeof accounts) => rows.map((row) => row.id)

describe('filterAccounts', () => {
  it('returns everyone by default', () => {
    expect(
      ids(
        filterAccounts(accounts, { search: '', role: 'all', clientId: 'all' }),
      ),
    ).toEqual(['1', '2', '3'])
  })

  it('searches name and email', () => {
    expect(
      ids(
        filterAccounts(accounts, {
          search: 'ACME.local',
          role: 'all',
          clientId: 'all',
        }),
      ),
    ).toEqual(['2'])
  })

  it('filters agency admins', () => {
    expect(
      ids(
        filterAccounts(accounts, {
          search: '',
          role: 'agency-admin',
          clientId: 'all',
        }),
      ),
    ).toEqual(['1'])
  })

  it('combines role with the client menu', () => {
    expect(
      ids(
        filterAccounts(accounts, {
          search: '',
          role: 'owner',
          clientId: 'all',
        }),
      ),
    ).toEqual(['2', '3'])
    expect(
      ids(
        filterAccounts(accounts, {
          search: '',
          role: 'owner',
          clientId: 'acme',
        }),
      ),
    ).toEqual(['2'])
    expect(
      ids(
        filterAccounts(accounts, {
          search: '',
          role: 'editor',
          clientId: 'acme',
        }),
      ),
    ).toEqual(['3'])
    expect(
      ids(
        filterAccounts(accounts, { search: '', role: 'all', clientId: 'nw' }),
      ),
    ).toEqual(['3'])
  })
})

describe('clientInitials', () => {
  it('uses the first two words or the first two letters', () => {
    expect(clientInitials('Northwind Studio')).toBe('NS')
    expect(clientInitials('acme')).toBe('AC')
    expect(clientInitials('  ')).toBe('?')
  })
})
