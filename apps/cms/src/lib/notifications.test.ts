import { describe, expect, it } from 'vitest'

import {
  AGENCY_EVENTS,
  EVENT_CATALOG,
  NOTIFICATION_EVENTS,
  ORG_EVENTS,
  eventMessageStem,
  eventReachesRole,
  isEventKey,
} from './notifications.ts'

describe('notification catalog', () => {
  it('shows org matrices only events that reach owners or editors', () => {
    expect(ORG_EVENTS).toContain('release.live')
    expect(ORG_EVENTS).toContain('schedule.failed')
    expect(ORG_EVENTS).not.toContain('agency.release.failed')
  })

  it('lists the agency alerts: every event with the agency role', () => {
    expect(AGENCY_EVENTS).toEqual(
      NOTIFICATION_EVENTS.filter((event) =>
        EVENT_CATALOG[event].roles.includes('agency'),
      ),
    )
    expect(AGENCY_EVENTS).toContain('agency.release.failed')
    expect(AGENCY_EVENTS).not.toContain('schedule.failed')
  })

  it('turns event keys into i18n stems', () => {
    expect(eventMessageStem('release.live.others')).toBe('release_live_others')
    expect(eventMessageStem('agency.release.failed')).toBe(
      'agency_release_failed',
    )
  })

  it('recognises event keys and rejects anything else', () => {
    expect(isEventKey('rollback.live')).toBe(true)
    expect(isEventKey('rollback')).toBe(false)
    expect(isEventKey('')).toBe(false)
  })

  it('answers which roles an event can reach', () => {
    expect(eventReachesRole('schedule.failed', 'editor')).toBe(false)
    expect(eventReachesRole('schedule.failed', 'owner')).toBe(true)
    expect(eventReachesRole('invite.accepted', 'agency')).toBe(true)
  })
})
