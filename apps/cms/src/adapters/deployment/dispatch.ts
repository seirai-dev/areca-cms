import {
  POLL_RETRY_DELAYS_MS,
  formatRetryDelay,
  retryTransient,
} from './shared'
import { DeploymentNotDispatchedError, DeploymentUncertainError } from './types'
import type { DeploymentContext } from './types'

/**
 * The dispatch protocol both deployment adapters follow: the deploy POST is
 * sent once, a failure after sending is reconciled against the upstream
 * listing, and an ambiguous outcome stays uncertain.
 */

type Log = (line: string) => void

/** Tolerated CMS-to-provider clock skew when comparing upstream creation times. */
const DISPATCH_CLOCK_SKEW_MS = 5_000

/** Earliest creation time a deployment of this dispatch can have, or null when unknown. */
export function dispatchedSince(context: DeploymentContext) {
  return context.dispatchedAt
    ? context.dispatchedAt.getTime() - DISPATCH_CLOCK_SKEW_MS
    : null
}

/** Whether an upstream timestamp parses and is at or after `sinceMs`. */
export function createdSince(value: unknown, sinceMs: number) {
  if (typeof value !== 'string') return false
  const created = Date.parse(value)
  return Number.isFinite(created) && created >= sinceMs
}

/**
 * Sends one deploy. `prepare` failing means nothing was sent. `post` returns
 * the upstream id, or null when the provider does not report one; a POST error
 * that `notDispatched` does not rule out is reconciled, never retried.
 */
export async function dispatchOnce(
  steps: {
    describe: string
    prepare: () => Promise<void>
    post: () => Promise<string | null>
    notDispatched: (error: unknown) => boolean
    reconcile: () => Promise<{ deploymentId: string } | null>
  },
  context: DeploymentContext,
  log: Log,
): Promise<{ deploymentId: string }> {
  log(
    `Deploying ${steps.describe} job=${context.jobId} publication=${context.publicationId} snapshot=${context.snapshotHash}`,
  )
  try {
    await steps.prepare()
  } catch (error) {
    throw new DeploymentNotDispatchedError(
      error instanceof Error ? error.message : String(error),
    )
  }
  let deploymentId: string | null
  try {
    deploymentId = await steps.post()
  } catch (error) {
    if (steps.notDispatched(error)) {
      throw new DeploymentNotDispatchedError((error as Error).message)
    }
    log(
      'Deploy response uncertain; reconciling the same dispatch before proceeding',
    )
    deploymentId = null
  }
  if (deploymentId === null) {
    const found = await steps.reconcile()
    if (!found)
      throw new DeploymentUncertainError(
        `Deployment acceptance unknown for job=${context.jobId} publication=${context.publicationId}; reconcile manually, do not redeploy`,
      )
    deploymentId = found.deploymentId
  }
  log(`upstream deployment=${deploymentId}`)
  return { deploymentId }
}

export function logReconciled(
  found: { deploymentId: string } | null,
  context: DeploymentContext,
  log: Log,
) {
  log(
    found
      ? `Reconciled upstream deployment=${found.deploymentId}`
      : `No matching dispatch job=${context.jobId}; acceptance remains unknown`,
  )
}

/** Calls `find` until it matches or the window closes (then null). */
export async function pollUntilMatch(options: {
  find: () => Promise<{ deploymentId: string } | null>
  timeoutMs: number
  pollMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
}) {
  const deadline = options.now() + options.timeoutMs
  for (;;) {
    const found = await options.find()
    if (found) return found
    const wait = Math.min(options.pollMs, deadline - options.now())
    if (wait <= 0) return null
    await options.sleep(wait)
  }
}

export type DeploymentPoll = {
  state: 'running' | 'done' | 'error'
  status: string | undefined
}

/** Polls one deployment until it finishes or `timeoutMs` passes. */
export async function waitForDeployment(options: {
  deploymentId: string
  poll: () => Promise<DeploymentPoll>
  timeoutMs: number
  pollMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  isTransient: (error: unknown) => boolean
  failureReason: (error: unknown) => string
  log: Log
  onError?: () => Promise<void>
}): Promise<'done' | 'error' | 'timeout'> {
  const { now, sleep, log } = options
  const deadline = now() + options.timeoutMs
  let lastStatus: string | undefined
  while (now() < deadline) {
    // A status poll survives about 30 seconds of transient failures, capped
    // to this wait's deadline, before the error is thrown as before.
    const result = await retryTransient(options.poll, {
      delays: POLL_RETRY_DELAYS_MS,
      isTransient: options.isTransient,
      sleep,
      now,
      deadline,
      onRetry: (error, delay) =>
        log(
          `poll failed (${options.failureReason(error)}); retrying in ${formatRetryDelay(delay)}`,
        ),
    })
    if (result.status !== lastStatus) {
      log(
        `deployment=${options.deploymentId} status=${result.status ?? 'unknown'}`,
      )
      lastStatus = result.status
    }
    if (result.state === 'error') {
      await options.onError?.()
      return 'error'
    }
    if (result.state === 'done') return 'done'
    const wait = Math.min(options.pollMs, deadline - now())
    if (wait <= 0) break
    await sleep(wait)
  }
  return 'timeout'
}
