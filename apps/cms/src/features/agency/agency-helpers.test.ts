import { describe, expect, it } from 'vitest'

import { clientInitials } from './queries'

describe('clientInitials', () => {
  it('uses the first two words or the first two letters', () => {
    expect(clientInitials('Northwind Studio')).toBe('NS')
    expect(clientInitials('acme')).toBe('AC')
    expect(clientInitials('  ')).toBe('?')
  })
})
