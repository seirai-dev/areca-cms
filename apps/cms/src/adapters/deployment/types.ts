export interface DeploymentTarget {
  provider: 'dokploy'
  applicationId: string
  healthCheckUrl: string
}

/** Immutable identity of a single logical dispatch, stable across recovery. */
export interface DeploymentContext {
  jobId: string
  publicationId: string
  snapshotHash: string
}

/** The adapter has established that no deploy request was sent/accepted. */
export class DeploymentNotDispatchedError extends Error {}
/** Acceptance or completion cannot be established; never redispatch blindly. */
export class DeploymentUncertainError extends Error {}

export interface DeploymentAdapter {
  deploy: (
    target: DeploymentTarget,
    log: (line: string) => void,
    context: DeploymentContext,
  ) => Promise<{ deploymentId: string }>
  reconcile?: (
    target: DeploymentTarget,
    context: DeploymentContext,
    log: (line: string) => void,
  ) => Promise<{ deploymentId: string } | null>
  waitForCompletion: (
    target: DeploymentTarget,
    deploymentId: string,
    opts: { timeoutMs: number; pollMs: number },
    log: (line: string) => void,
  ) => Promise<'done' | 'error' | 'timeout'>
  healthCheck: (
    url: string,
    opts: {
      timeoutMs: number
      intervalMs: number
      expectPublicationId?: string
    },
  ) => Promise<boolean>
}
