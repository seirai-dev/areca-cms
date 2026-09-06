import type { DeploymentAdapter } from './types'

export function createMockDeploymentAdapter(): DeploymentAdapter {
  return {
    async deploy() {
      return { deploymentId: 'mock' }
    },
    async waitForCompletion() {
      return 'done'
    },
    async healthCheck() {
      return true
    },
  }
}
