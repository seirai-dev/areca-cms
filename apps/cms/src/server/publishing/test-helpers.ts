import type { DeploymentAdapter } from '#/adapters/deployment/types'
import type { buildJob } from '#/db/schema'

/**
 * The job a publication request returned. A fresh request always has one; only
 * a replayed key whose job retention pruned comes back without it.
 */
export function jobOf<T extends { job: typeof buildJob.$inferSelect | null }>(
  result: T,
) {
  if (!result.job) throw new Error('Expected the request job')
  return result.job
}

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
