import { describe, expect, it } from 'vitest'

import { settingsTabsFor } from './settings-tabs'

describe('settingsTabsFor', () => {
  it('gives a development environment no Deployment and no Development tab', () => {
    expect(
      settingsTabsFor({
        environment: 'development',
        publishingMode: 'demo',
        hasGoneLive: false,
      }),
    ).toEqual(['general', 'languages', 'developer', 'ai', 'content'])
  })

  it('offers Development on a production site once it is in Production mode or has gone live', () => {
    const base = { environment: 'production', publishingMode: 'demo' }
    expect(settingsTabsFor({ ...base, hasGoneLive: false })).not.toContain(
      'development',
    )
    expect(settingsTabsFor({ ...base, hasGoneLive: true })).toContain(
      'development',
    )
    expect(
      settingsTabsFor({
        environment: 'production',
        publishingMode: 'production',
        hasGoneLive: false,
      }),
    ).toContain('development')
  })
})
