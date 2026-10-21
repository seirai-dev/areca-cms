import { describe, expect, it } from 'vitest'

import { choiceOrganization, resolvePreference } from './preferences.ts'

const ON = { enabled: true, locked: false }
const OFF = { enabled: false, locked: false }
const ORG_LOCK = { enabled: true, locked: true }
const AGENCY_LOCK = { enabled: true, locked: true }

describe('resolvePreference', () => {
  it('falls back to the built-in default when nothing is set', () => {
    expect(resolvePreference({ event: 'release.live', role: 'owner' })).toEqual(
      { enabled: true, lockedBy: null, source: 'builtin' },
    )
    expect(
      resolvePreference({ event: 'release.live.others', role: 'owner' }),
    ).toEqual({ enabled: false, lockedBy: null, source: 'builtin' })
  })

  it('uses the organization default over the agency default', () => {
    expect(
      resolvePreference({
        event: 'release.live',
        role: 'editor',
        orgRule: OFF,
        agencyRule: ON,
      }),
    ).toEqual({ enabled: false, lockedBy: null, source: 'organization' })
  })

  it('uses the agency default when the organization has no rule', () => {
    expect(
      resolvePreference({
        event: 'release.live.others',
        role: 'owner',
        agencyRule: ON,
      }),
    ).toEqual({ enabled: true, lockedBy: null, source: 'agency' })
  })

  it('lets the user choice beat organization and agency defaults', () => {
    expect(
      resolvePreference({
        event: 'release.live',
        role: 'owner',
        orgRule: OFF,
        agencyRule: OFF,
        userChoice: true,
      }),
    ).toEqual({ enabled: true, lockedBy: null, source: 'user' })
  })

  it('treats an explicit null choice as no choice', () => {
    expect(
      resolvePreference({
        event: 'release.live',
        role: 'owner',
        orgRule: OFF,
        userChoice: null,
      }),
    ).toEqual({ enabled: false, lockedBy: null, source: 'organization' })
  })

  it('keeps an agency lock on even when the user turned the event off', () => {
    expect(
      resolvePreference({
        event: 'release.failed',
        role: 'owner',
        agencyRule: AGENCY_LOCK,
        userChoice: false,
      }),
    ).toEqual({ enabled: true, lockedBy: 'agency', source: 'agency_lock' })
  })

  it('keeps an organization lock on even when the user turned the event off', () => {
    expect(
      resolvePreference({
        event: 'release.failed',
        role: 'editor',
        orgRule: ORG_LOCK,
        userChoice: false,
      }),
    ).toEqual({
      enabled: true,
      lockedBy: 'organization',
      source: 'organization_lock',
    })
  })

  it('reports the agency lock when both levels lock the event', () => {
    expect(
      resolvePreference({
        event: 'release.failed',
        role: 'owner',
        agencyRule: AGENCY_LOCK,
        orgRule: ORG_LOCK,
      }),
    ).toEqual({ enabled: true, lockedBy: 'agency', source: 'agency_lock' })
  })

  it('ignores organization rules for agency-role recipients', () => {
    expect(
      resolvePreference({
        event: 'release.failed',
        role: 'agency',
        orgRule: { enabled: false, locked: true },
      }),
    ).toEqual({ enabled: true, lockedBy: null, source: 'builtin' })
  })

  it('still applies agency locks to agency-role recipients', () => {
    expect(
      resolvePreference({
        event: 'release.failed',
        role: 'agency',
        agencyRule: AGENCY_LOCK,
        userChoice: false,
      }),
    ).toEqual({ enabled: true, lockedBy: 'agency', source: 'agency_lock' })
  })

  it('ignores organization rules for agency.* events, whatever the role', () => {
    expect(
      resolvePreference({
        event: 'agency.release.failed',
        role: 'owner',
        orgRule: OFF,
        userChoice: null,
      }),
    ).toEqual({ enabled: true, lockedBy: null, source: 'builtin' })
  })

  it('reads the agency default for agency alerts with an agency rule', () => {
    expect(
      resolvePreference({
        event: 'agency.release.failed',
        role: 'agency',
        agencyRule: OFF,
      }),
    ).toEqual({ enabled: false, lockedBy: null, source: 'agency' })
  })
})

describe('choiceOrganization', () => {
  it('keys agency-role choices to no organization', () => {
    expect(choiceOrganization('agency', 'org-1')).toBeNull()
    expect(choiceOrganization('owner', 'org-1')).toBe('org-1')
    expect(choiceOrganization('editor', null)).toBeNull()
  })
})
