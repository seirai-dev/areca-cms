import { describe, expect, it } from 'vitest'

import { greeting, greetingName } from './greeting'

describe('greetingName', () => {
  it('uses the first word of a person name', () => {
    expect(greetingName('Kaan Kaya')).toBe('Kaan')
    expect(greetingName('  Ada  ')).toBe('Ada')
  })

  it('drops role and team words', () => {
    expect(greetingName('Agency Admin')).toBeNull()
    expect(greetingName('Editor')).toBeNull()
    expect(greetingName('Team Acme')).toBeNull()
  })

  it('drops a first word that is the client or site name', () => {
    expect(greetingName('Acme Owner', ['Acme', 'Acme Website'])).toBeNull()
    expect(greetingName('Northwind Studio', ['Northwind'])).toBeNull()
    expect(greetingName('Kaan Kaya', ['Acme'])).toBe('Kaan')
  })

  it('drops emails and empty names', () => {
    expect(greetingName('kaan@example.com')).toBeNull()
    expect(greetingName('')).toBeNull()
    expect(greetingName(null)).toBeNull()
  })
})

describe('greeting', () => {
  it('follows the local hour', () => {
    expect(greeting('Kaan', 9)).toBe('Good morning, Kaan')
    expect(greeting('Kaan', 14)).toBe('Good afternoon, Kaan')
    expect(greeting('Kaan', 21)).toBe('Good evening, Kaan')
    expect(greeting('Kaan', 3)).toBe('Good evening, Kaan')
  })

  it('greets without a name when there is none', () => {
    expect(greeting(null, 9)).toBe('Good morning')
    expect(greeting(null, 14)).toBe('Good afternoon')
    expect(greeting(null, 20)).toBe('Good evening')
  })
})
