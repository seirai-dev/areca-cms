import { describe, expect, it } from 'vitest'

import type {
  CloudflareDeployTarget,
  CloudflareDeployTargets,
} from '#/adapters/deployment/cloudflare-targets'
import type { DeploymentTarget } from '#/lib/types'

import {
  buildDeploymentTarget,
  findListed,
  listedValue,
  matchesTargetSearch,
  nextHealthUrl,
  pickTrigger,
  selectionFromListed,
  selectionFromTarget,
  selectionStatus,
  selectionValue,
  targetIdentity,
} from './deployment-target-draft'
import type { CloudflareSelection } from './deployment-target-draft'

const HEALTH = 'https://shop.example.com/api/health'
const TAG = 'a'.repeat(32)
const TRIGGER = '11111111-2222-4333-8444-555555555555'

const pages: CloudflareDeployTarget = {
  kind: 'pages',
  name: 'marketing-site',
  scriptTag: null,
  productionBranch: 'main',
  primaryDomain: 'marketing.example.com',
  suggestedHealthUrl: 'https://marketing.example.com/api/health',
  buildable: true,
  disabledReason: null,
  triggers: [],
  autoTriggerUuid: null,
}

const shop: CloudflareDeployTarget = {
  kind: 'workers',
  name: 'shop-worker',
  scriptTag: TAG,
  productionBranch: 'main',
  primaryDomain: 'shop-worker.acct.workers.dev',
  suggestedHealthUrl: 'https://shop-worker.acct.workers.dev/api/health',
  buildable: true,
  disabledReason: null,
  triggers: [
    { triggerUuid: TRIGGER, name: 'main', branch: 'main', preview: false },
    {
      triggerUuid: 'other-trigger',
      name: 'preview',
      branch: 'main',
      preview: true,
    },
  ],
  autoTriggerUuid: TRIGGER,
}

const targets: CloudflareDeployTargets = {
  pages: [pages],
  workers: [shop],
  fetchedAt: '2026-11-02T10:00:00.000Z',
}

describe('selectionFromTarget and selectionFromListed', () => {
  it('reads the saved Pages and Workers targets', () => {
    const savedPages: DeploymentTarget = {
      provider: 'cloudflare',
      kind: 'pages',
      projectName: 'marketing-site',
      branch: 'main',
      healthCheckUrl: HEALTH,
    }
    expect(selectionFromTarget(savedPages)).toEqual({
      kind: 'pages',
      name: 'marketing-site',
      branch: 'main',
    })
    expect(
      selectionFromTarget({
        provider: 'cloudflare',
        kind: 'workers',
        scriptName: 'shop-worker',
        scriptTag: TAG,
        triggerUuid: TRIGGER,
        branch: 'main',
        healthCheckUrl: HEALTH,
      }),
    ).toEqual({
      kind: 'workers',
      name: 'shop-worker',
      scriptTag: TAG,
      triggerUuid: TRIGGER,
      branch: 'main',
    })
  })

  it('ignores Dokploy and empty targets', () => {
    expect(selectionFromTarget(null)).toBeNull()
    expect(
      selectionFromTarget({
        provider: 'dokploy',
        applicationId: 'app',
        healthCheckUrl: HEALTH,
      }),
    ).toBeNull()
  })

  it('picks the auto trigger for a listed Worker', () => {
    expect(selectionFromListed(shop)).toEqual({
      kind: 'workers',
      name: 'shop-worker',
      scriptTag: TAG,
      triggerUuid: TRIGGER,
      branch: 'main',
    })
  })

  it('leaves the trigger empty when the Worker has no auto trigger', () => {
    expect(
      selectionFromListed({
        ...shop,
        autoTriggerUuid: null,
        productionBranch: null,
      }),
    ).toEqual({
      kind: 'workers',
      name: 'shop-worker',
      scriptTag: TAG,
      triggerUuid: null,
      branch: null,
    })
  })
})

describe('buildDeploymentTarget', () => {
  it('builds the Dokploy shape and needs an application and a health URL', () => {
    expect(
      buildDeploymentTarget({
        provider: 'dokploy',
        applicationId: 'app-1',
        selection: null,
        healthCheckUrl: HEALTH,
      }),
    ).toEqual({
      provider: 'dokploy',
      applicationId: 'app-1',
      healthCheckUrl: HEALTH,
    })
    expect(
      buildDeploymentTarget({
        provider: 'dokploy',
        applicationId: '',
        selection: null,
        healthCheckUrl: HEALTH,
      }),
    ).toBeNull()
    expect(
      buildDeploymentTarget({
        provider: 'dokploy',
        applicationId: 'app-1',
        selection: null,
        healthCheckUrl: '',
      }),
    ).toBeNull()
  })

  it('builds the Pages union from the selection', () => {
    expect(
      buildDeploymentTarget({
        provider: 'cloudflare',
        applicationId: '',
        selection: { kind: 'pages', name: 'marketing-site', branch: 'main' },
        healthCheckUrl: HEALTH,
      }),
    ).toEqual({
      provider: 'cloudflare',
      kind: 'pages',
      projectName: 'marketing-site',
      branch: 'main',
      healthCheckUrl: HEALTH,
    })
  })

  it('builds the Workers union only with a trigger and its branch', () => {
    expect(
      buildDeploymentTarget({
        provider: 'cloudflare',
        applicationId: '',
        selection: selectionFromListed(shop),
        healthCheckUrl: HEALTH,
      }),
    ).toEqual({
      provider: 'cloudflare',
      kind: 'workers',
      scriptName: 'shop-worker',
      scriptTag: TAG,
      triggerUuid: TRIGGER,
      branch: 'main',
      healthCheckUrl: HEALTH,
    })
    expect(
      buildDeploymentTarget({
        provider: 'cloudflare',
        applicationId: '',
        selection: {
          kind: 'workers',
          name: 'shop-worker',
          scriptTag: TAG,
          triggerUuid: null,
          branch: null,
        },
        healthCheckUrl: HEALTH,
      }),
    ).toBeNull()
  })

  it('sends null without a Cloudflare selection', () => {
    expect(
      buildDeploymentTarget({
        provider: 'cloudflare',
        applicationId: '',
        selection: null,
        healthCheckUrl: HEALTH,
      }),
    ).toBeNull()
  })
})

describe('saved selection status', () => {
  const saved = (name: string): CloudflareSelection => ({
    kind: 'pages',
    name,
    branch: 'main',
  })

  it('is unknown until the list loads', () => {
    expect(selectionStatus(saved('marketing-site'), undefined)).toBe('unknown')
  })

  it('finds a saved project by name and a saved Worker by tag', () => {
    expect(selectionStatus(saved('marketing-site'), targets)).toBe('found')
    expect(selectionStatus(saved('gone-site'), targets)).toBe('missing')
    expect(
      selectionStatus(
        {
          kind: 'workers',
          name: 'shop-worker',
          scriptTag: TAG,
          triggerUuid: TRIGGER,
          branch: 'main',
        },
        targets,
      ),
    ).toBe('found')
    expect(
      selectionStatus(
        {
          kind: 'workers',
          name: 'renamed',
          scriptTag: 'b'.repeat(32),
          triggerUuid: null,
          branch: null,
        },
        targets,
      ),
    ).toBe('missing')
  })

  it('counts a Worker whose saved trigger is gone as missing', () => {
    expect(
      selectionStatus(
        {
          kind: 'workers',
          name: 'shop-worker',
          scriptTag: TAG,
          triggerUuid: 'deleted',
          branch: 'main',
        },
        targets,
      ),
    ).toBe('missing')
  })

  it('finds the listed item for a selection', () => {
    expect(findListed(saved('marketing-site'), targets)).toBe(pages)
    expect(findListed(saved('nope'), targets)).toBeNull()
    expect(selectionValue(saved('marketing-site'))).toBe(listedValue(pages))
    expect(selectionValue(selectionFromListed(shop))).toBe(listedValue(shop))
  })
})

describe('pickTrigger', () => {
  it('sets the trigger and its branch on a Worker selection', () => {
    const selection = selectionFromListed({
      ...shop,
      autoTriggerUuid: null,
      productionBranch: null,
    })
    expect(pickTrigger(selection, shop, TRIGGER)).toEqual({
      kind: 'workers',
      name: 'shop-worker',
      scriptTag: TAG,
      triggerUuid: TRIGGER,
      branch: 'main',
    })
  })

  it('clears the choice for an unknown trigger and leaves Pages alone', () => {
    const selection = selectionFromListed(shop)
    expect(pickTrigger(selection, shop, 'nope')).toMatchObject({
      triggerUuid: null,
      branch: null,
    })
    const savedPages: CloudflareSelection = {
      kind: 'pages',
      name: 'marketing-site',
      branch: 'main',
    }
    expect(pickTrigger(savedPages, shop, TRIGGER)).toBe(savedPages)
  })
})

describe('nextHealthUrl', () => {
  const suggestion = 'https://marketing.example.com/api/health'

  it('fills an empty field from the suggestion', () => {
    expect(
      nextHealthUrl({ current: '', previousSuggestion: null, suggestion }),
    ).toBe(suggestion)
    expect(
      nextHealthUrl({ current: '   ', previousSuggestion: null, suggestion }),
    ).toBe(suggestion)
  })

  it('replaces the previous suggestion but keeps a URL the admin typed', () => {
    expect(
      nextHealthUrl({
        current: 'https://marketing.example.com/api/health',
        previousSuggestion: 'https://marketing.example.com/api/health',
        suggestion: 'https://shop.example.com/api/health',
      }),
    ).toBe('https://shop.example.com/api/health')
    expect(
      nextHealthUrl({
        current: 'https://custom.example.com/health',
        previousSuggestion: 'https://marketing.example.com/api/health',
        suggestion: 'https://shop.example.com/api/health',
      }),
    ).toBeNull()
  })

  it('keeps the current value when there is no suggestion', () => {
    expect(
      nextHealthUrl({
        current: '',
        previousSuggestion: null,
        suggestion: null,
      }),
    ).toBeNull()
  })
})

describe('targetIdentity', () => {
  it('differs by target, trigger and branch, and matches the same target', () => {
    const base: CloudflareSelection = {
      kind: 'workers',
      name: 'shop-worker',
      scriptTag: TAG,
      triggerUuid: TRIGGER,
      branch: 'main',
    }
    expect(targetIdentity('dokploy', 'app-1', null)).toBe('dokploy:app-1')
    expect(targetIdentity('cloudflare', '', base)).toBe(
      targetIdentity('cloudflare', '', { ...base }),
    )
    expect(targetIdentity('cloudflare', '', base)).not.toBe(
      targetIdentity('cloudflare', '', { ...base, triggerUuid: 'other' }),
    )
    expect(targetIdentity('cloudflare', '', base)).not.toBe(
      targetIdentity('cloudflare', '', { ...base, branch: 'dev' }),
    )
    expect(targetIdentity('cloudflare', '', null)).not.toBe(
      targetIdentity('dokploy', '', null),
    )
  })
})

describe('matchesTargetSearch', () => {
  it('matches every word against any field, case-insensitively', () => {
    const fields = ['marketing-site', 'marketing.example.com', 'main']
    expect(matchesTargetSearch('', fields)).toBe(true)
    expect(matchesTargetSearch('MARKET', fields)).toBe(true)
    expect(matchesTargetSearch('example main', fields)).toBe(true)
    expect(matchesTargetSearch('shop', fields)).toBe(false)
    expect(matchesTargetSearch('main shop', fields)).toBe(false)
    expect(matchesTargetSearch('main', [null, undefined, 'main'])).toBe(true)
  })
})
