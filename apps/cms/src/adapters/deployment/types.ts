import type { DeploymentTarget } from '#/lib/types'

export type {
  CloudflarePagesDeploymentTarget,
  CloudflareWorkersDeploymentTarget,
  DeploymentTarget,
  DokployDeploymentTarget,
} from '#/lib/types'

/** Immutable identity of a single logical dispatch, stable across recovery. */
export interface DeploymentContext {
  jobId: string
  publicationId: string
  snapshotHash: string
  /**
   * When the dispatch intent was recorded, before the deploy request was sent.
   * Stable across recovery (persisted as build_job.dispatch_started_at). Some
   * providers ignore the identity we send, so adapters may use it as evidence.
   */
  dispatchedAt?: Date
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
