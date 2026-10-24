import { describe, expect, it } from 'vitest'

import { activeAdminCount, isLastActiveAdmin } from './person-facts'

const people = [
  { id: 'a', status: 'active' as const, isAgencyAdmin: true },
  { id: 'b', status: 'blocked' as const, isAgencyAdmin: true },
  { id: 'c', status: 'active' as const, isAgencyAdmin: false },
]

describe('activeAdminCount', () => {
  it('ignores blocked admins and people who are not admins', () => {
    expect(activeAdminCount(people)).toBe(1)
  })
})

describe('isLastActiveAdmin', () => {
  it('is true for the only active admin', () => {
    expect(isLastActiveAdmin(people, 'a')).toBe(true)
  })

  it('is false when another active admin exists', () => {
    const two = [
      ...people,
      { id: 'd', status: 'active' as const, isAgencyAdmin: true },
    ]
    expect(isLastActiveAdmin(two, 'a')).toBe(false)
  })

  it('is false for blocked admins and for people who are not admins', () => {
    expect(isLastActiveAdmin(people, 'b')).toBe(false)
    expect(isLastActiveAdmin(people, 'c')).toBe(false)
    expect(isLastActiveAdmin(people, 'missing')).toBe(false)
  })
})
