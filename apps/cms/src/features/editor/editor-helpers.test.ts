import { describe, expect, it } from 'vitest'

import { groupRevisions } from './revision-groups'
import { presetInstant, wallTime, zonedToInstant } from './schedule-time'

const at = (iso: string) => new Date(iso)

describe('groupRevisions', () => {
  const rev = (
    id: string,
    minutesAgo: number,
    note: string,
    createdBy = 'u1',
  ) => ({
    id,
    note,
    createdBy,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60_000),
  })

  it('collapses consecutive saves by one author within 15 minutes', () => {
    const groups = groupRevisions([
      rev('a', 0, 'update'),
      rev('b', 5, 'update'),
      rev('c', 14, 'update'),
      rev('d', 40, 'update'),
      rev('e', 41, 'publish'),
      rev('f', 42, 'update', 'u2'),
      rev('g', 43, 'update'),
      rev('h', 50, 'create'),
    ])
    expect(
      groups.map((group) => [group.note, group.items.map((i) => i.id)]),
    ).toEqual([
      ['update', ['a', 'b', 'c']],
      ['update', ['d']],
      ['publish', ['e']],
      ['update', ['f']],
      ['update', ['g']],
      ['create', ['h']],
    ])
  })

  it('never merges non-update notes', () => {
    const groups = groupRevisions([
      rev('a', 0, 'publish'),
      rev('b', 1, 'publish'),
    ])
    expect(groups).toHaveLength(2)
  })
})

describe('schedule time', () => {
  it('reads wall time in a zone', () => {
    expect(wallTime(at('2026-07-01T07:30:00Z'), 'Europe/Amsterdam')).toEqual({
      date: '2026-07-01',
      time: '09:30',
    })
  })

  it('turns a wall time in a zone into an instant (DST aware)', () => {
    expect(
      zonedToInstant('2026-07-01', '09:00', 'Europe/Amsterdam')?.toISOString(),
    ).toBe('2026-07-01T07:00:00.000Z')
    expect(
      zonedToInstant('2026-01-15', '09:00', 'Europe/Amsterdam')?.toISOString(),
    ).toBe('2026-01-15T08:00:00.000Z')
    expect(
      zonedToInstant('2026-01-15', '09:00', 'America/New_York')?.toISOString(),
    ).toBe('2026-01-15T14:00:00.000Z')
    expect(zonedToInstant('', '09:00', 'UTC')).toBeNull()
  })

  it('computes the quick chips', () => {
    // Tuesday 29 September 2026, 14:07 in Amsterdam.
    const now = at('2026-09-29T12:07:00Z')
    expect(
      presetInstant('tomorrow', 'Europe/Amsterdam', now).toISOString(),
    ).toBe('2026-09-30T07:00:00.000Z')
    expect(presetInstant('monday', 'Europe/Amsterdam', now).toISOString()).toBe(
      '2026-10-05T07:00:00.000Z',
    )
    const hour = presetInstant('hour', 'UTC', now)
    expect(hour.getTime() - now.getTime()).toBeGreaterThanOrEqual(60 * 60_000)
    expect(hour.getMinutes() % 5).toBe(0)
    // On a Monday, "Monday" means next week.
    const monday = at('2026-10-05T06:00:00Z')
    expect(presetInstant('monday', 'UTC', monday).toISOString()).toBe(
      '2026-10-12T09:00:00.000Z',
    )
  })
})
