import { describe, expect, it } from 'vitest'

import {
  deploymentTargetResourceId,
  hasCompleteDeploymentTarget,
} from './deployment-target'
import type { DeploymentTarget } from './types'

const dokploy: DeploymentTarget = {
  provider: 'dokploy',
  applicationId: 'app-1',
  healthCheckUrl: 'https://site.example.test/health',
}
const pages: DeploymentTarget = {
  provider: 'cloudflare',
  kind: 'pages',
  projectName: 'areca-site',
  branch: 'main',
  healthCheckUrl: 'https://site.example.test/health',
}
const workers: DeploymentTarget = {
  provider: 'cloudflare',
  kind: 'workers',
  scriptName: 'areca-worker',
  scriptTag: 'c'.repeat(32),
  triggerUuid: '11111111-2222-4333-8444-555555555555',
  branch: 'main',
  healthCheckUrl: 'https://site.example.test/health',
}

describe('deploymentTargetResourceId', () => {
  it('returns the application ID, project name or script tag per provider', () => {
    expect(deploymentTargetResourceId(dokploy)).toBe('app-1')
    expect(deploymentTargetResourceId(pages)).toBe('areca-site')
    expect(deploymentTargetResourceId(workers)).toBe('c'.repeat(32))
  })
})

describe('hasCompleteDeploymentTarget', () => {
  it('accepts a complete target of every provider', () => {
    expect(hasCompleteDeploymentTarget(dokploy)).toBe(true)
    expect(hasCompleteDeploymentTarget(pages)).toBe(true)
    expect(hasCompleteDeploymentTarget(workers)).toBe(true)
  })

  it('rejects a missing target or health URL', () => {
    expect(hasCompleteDeploymentTarget(null)).toBe(false)
    expect(hasCompleteDeploymentTarget(undefined)).toBe(false)
    expect(hasCompleteDeploymentTarget({ ...pages, healthCheckUrl: '' })).toBe(
      false,
    )
    expect(
      hasCompleteDeploymentTarget({ ...dokploy, healthCheckUrl: '' }),
    ).toBe(false)
  })

  it('rejects a target missing the identifiers that dispatch needs', () => {
    expect(hasCompleteDeploymentTarget({ ...dokploy, applicationId: '' })).toBe(
      false,
    )
    expect(hasCompleteDeploymentTarget({ ...pages, projectName: '' })).toBe(
      false,
    )
    expect(hasCompleteDeploymentTarget({ ...pages, branch: '' })).toBe(false)
    expect(hasCompleteDeploymentTarget({ ...workers, scriptTag: '' })).toBe(
      false,
    )
    expect(hasCompleteDeploymentTarget({ ...workers, triggerUuid: '' })).toBe(
      false,
    )
  })
})
