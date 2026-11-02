import { describe, expect, it } from 'vitest'

import { deploymentTargetSchema } from './sites'

const health = 'https://site.example.test/health'
const scriptTag = 'd'.repeat(32)
const triggerUuid = '11111111-2222-4333-8444-555555555555'

describe('deploymentTargetSchema', () => {
  it('accepts a Dokploy, Pages or Workers target and a cleared target', () => {
    expect(
      deploymentTargetSchema.parse({
        provider: 'dokploy',
        applicationId: 'app-1',
        healthCheckUrl: health,
      }),
    ).toEqual({
      provider: 'dokploy',
      applicationId: 'app-1',
      healthCheckUrl: health,
    })
    expect(
      deploymentTargetSchema.parse({
        provider: 'cloudflare',
        kind: 'pages',
        projectName: 'areca-site-2',
        branch: 'main',
        healthCheckUrl: health,
      }),
    ).toMatchObject({ kind: 'pages', projectName: 'areca-site-2' })
    expect(
      deploymentTargetSchema.parse({
        provider: 'cloudflare',
        kind: 'workers',
        scriptName: 'areca-worker',
        scriptTag,
        triggerUuid,
        branch: 'main',
        healthCheckUrl: health,
      }),
    ).toMatchObject({ kind: 'workers', scriptTag, triggerUuid })
    expect(deploymentTargetSchema.parse(null)).toBeNull()
  })

  it('checks the Pages project name', () => {
    const base = {
      provider: 'cloudflare',
      kind: 'pages',
      branch: 'main',
      healthCheckUrl: health,
    }
    for (const projectName of ['Areca', 'areca_site', '-areca', '']) {
      expect(() =>
        deploymentTargetSchema.parse({ ...base, projectName }),
      ).toThrow()
    }
    expect(
      deploymentTargetSchema.parse({ ...base, projectName: 'a1-b2' }),
    ).toMatchObject({ projectName: 'a1-b2' })
  })

  it('checks the Worker script tag, trigger UUID and branch', () => {
    const base = {
      provider: 'cloudflare',
      kind: 'workers',
      scriptName: 'areca-worker',
      scriptTag,
      triggerUuid,
      branch: 'main',
      healthCheckUrl: health,
    }
    expect(() =>
      deploymentTargetSchema.parse({ ...base, scriptTag: 'xyz' }),
    ).toThrow()
    expect(() =>
      deploymentTargetSchema.parse({ ...base, triggerUuid: 'nope' }),
    ).toThrow()
    expect(() =>
      deploymentTargetSchema.parse({ ...base, branch: '  ' }),
    ).toThrow()
    expect(() =>
      deploymentTargetSchema.parse({ ...base, scriptName: '' }),
    ).toThrow()
  })

  it('requires an HTTP or HTTPS health URL for every provider', () => {
    expect(() =>
      deploymentTargetSchema.parse({
        provider: 'dokploy',
        applicationId: 'app-1',
        healthCheckUrl: 'ftp://site.example.test/health',
      }),
    ).toThrow()
    expect(() =>
      deploymentTargetSchema.parse({
        provider: 'cloudflare',
        kind: 'pages',
        projectName: 'areca',
        branch: 'main',
        healthCheckUrl: 'not a url',
      }),
    ).toThrow()
  })

  it('rejects an unknown provider or kind', () => {
    expect(() =>
      deploymentTargetSchema.parse({
        provider: 'vercel',
        applicationId: 'app-1',
        healthCheckUrl: health,
      }),
    ).toThrow()
    expect(() =>
      deploymentTargetSchema.parse({
        provider: 'cloudflare',
        kind: 'containers',
        projectName: 'areca',
        branch: 'main',
        healthCheckUrl: health,
      }),
    ).toThrow()
  })
})
