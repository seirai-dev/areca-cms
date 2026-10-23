import { describe, expect, it } from 'vitest'

import { buildGettingStartedSteps } from './use-getting-started'
import type { GettingStartedFacts } from './use-getting-started'

const none: GettingStartedFacts = {
  clients: [],
  sites: [],
  hasMember: false,
  hasPendingInvite: false,
}

const site = (
  id: string,
  patch: Partial<GettingStartedFacts['sites'][number]> = {},
) => ({
  id,
  organizationId: 'org-1',
  collections: 0,
  live: false,
  ...patch,
})

const doneKeys = (facts: GettingStartedFacts) =>
  buildGettingStartedSteps(facts)
    .filter((step) => step.done)
    .map((step) => step.key)

describe('buildGettingStartedSteps', () => {
  it('starts with nothing done and the first action open', () => {
    const steps = buildGettingStartedSteps(none)
    expect(steps.map((step) => step.key)).toEqual([
      'client',
      'site',
      'connect',
      'invite',
      'live',
    ])
    expect(doneKeys(none)).toEqual([])
    // Only the client step can be acted on before a client exists.
    expect(steps[0].target).toEqual({ kind: 'new-client' })
    expect(steps[1].target).toBeNull()
    expect(steps[4].target).toBeNull()
  })

  it('marks the client done and points "add a site" at that client', () => {
    const steps = buildGettingStartedSteps({
      ...none,
      clients: [{ id: 'org-1' }],
    })
    expect(doneKeys({ ...none, clients: [{ id: 'org-1' }] })).toEqual([
      'client',
    ])
    expect(steps[1].target).toEqual({ kind: 'new-site', orgId: 'org-1' })
  })

  it('leaves the client open when there are several clients', () => {
    const steps = buildGettingStartedSteps({
      ...none,
      clients: [{ id: 'org-1' }, { id: 'org-2' }],
    })
    expect(steps[1].target).toEqual({ kind: 'new-site', orgId: null })
  })

  it('connects the site that has no collections first', () => {
    const steps = buildGettingStartedSteps({
      ...none,
      clients: [{ id: 'org-1' }],
      sites: [site('a', { collections: 3 }), site('b')],
    })
    expect(steps[2].done).toBe(true)
    expect(steps[2].target).toEqual({ kind: 'developer', siteId: 'b' })
  })

  it('counts a member or a pending invitation for the invite step', () => {
    expect(doneKeys({ ...none, hasMember: true })).toContain('invite')
    expect(doneKeys({ ...none, hasPendingInvite: true })).toContain('invite')
    expect(doneKeys(none)).not.toContain('invite')
  })

  it('is complete when every step is done', () => {
    const facts: GettingStartedFacts = {
      clients: [{ id: 'org-1' }],
      sites: [site('a', { collections: 2, live: true })],
      hasMember: true,
      hasPendingInvite: false,
    }
    expect(doneKeys(facts)).toEqual([
      'client',
      'site',
      'connect',
      'invite',
      'live',
    ])
  })
})
