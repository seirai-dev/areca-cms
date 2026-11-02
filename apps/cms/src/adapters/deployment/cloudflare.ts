import { CloudflareApiError } from './cloudflare-api'
import type {
  CloudflareClient,
  CloudflarePagesDeployment,
  CloudflareWorkerBuild,
} from './cloudflare-api'
import { createHealthChecker } from './health-check'
import type { HealthCheckOptions } from './health-check'
import { sleep } from './shared'
import { DeploymentNotDispatchedError, DeploymentUncertainError } from './types'
import type {
  CloudflarePagesDeploymentTarget,
  CloudflareWorkersDeploymentTarget,
  DeploymentAdapter,
  DeploymentContext,
  DeploymentTarget,
} from './types'

/** Tolerated CMS-to-Cloudflare clock skew when comparing created_on. */
const DISPATCH_CLOCK_SKEW_MS = 5_000
const LOG_TAIL_LINES = 100
const DEFAULT_RECONCILE_TIMEOUT_MS = 30_000
const DEFAULT_RECONCILE_POLL_MS = 1_000
const READ_ATTEMPTS = 3
const DASHBOARD = 'https://dash.cloudflare.com'

export type CloudflareAdapterOptions = HealthCheckOptions & {
  client: CloudflareClient
  accountId: string
  now?: () => Date
  reconciliationTimeoutMs?: number
  reconciliationPollMs?: number
}

type CloudflareTarget =
  CloudflarePagesDeploymentTarget | CloudflareWorkersDeploymentTarget

type Poll = { state: 'running' | 'done' | 'error'; status: string }

/**
 * Deploys a Cloudflare Pages project (git build of a branch) or a Worker
 * (Workers Builds trigger). Follows the same dispatch safety as the Dokploy
 * adapter: a POST is sent once, a failure after sending is reconciled against
 * the upstream listing, and an ambiguous outcome stays uncertain.
 */
export function createCloudflareAdapter(
  options: CloudflareAdapterOptions,
): DeploymentAdapter {
  const { client, accountId } = options
  const now = () => (options.now ? options.now() : new Date()).getTime()
  const healthCheck = createHealthChecker(options)

  /** Pages: the deployment ID. Workers: the build UUID. */
  async function dispatch(target: CloudflareTarget): Promise<string> {
    if (target.kind === 'pages') {
      const deployment = await client.createPagesDeployment(
        target.projectName,
        target.branch,
      )
      return deployment.id
    }
    const build = await client.createWorkerBuild(
      target.triggerUuid,
      target.branch,
    )
    return build.buildUuid
  }

  /** Dispatch identities that match this target, created after the dispatch. */
  async function matchesSince(
    target: CloudflareTarget,
    sinceMs: number,
  ): Promise<string[]> {
    if (target.kind === 'pages') {
      const deployments = await client.listPagesDeployments(
        target.projectName,
        { environment: 'production' },
      )
      return deployments
        .filter(
          (item) =>
            item.trigger.type === 'ad_hoc' &&
            item.trigger.branch === target.branch &&
            createdSince(item.createdOn, sinceMs),
        )
        .map((item) => item.id)
    }
    const builds = await client.listWorkerBuilds(target.scriptTag)
    return builds
      .filter(
        (item) =>
          item.triggerUuid === target.triggerUuid &&
          item.buildTriggerSource === 'manual' &&
          item.branch === target.branch &&
          createdSince(item.createdOn, sinceMs),
      )
      .map((item) => item.buildUuid)
  }

  /**
   * Polls the upstream listing for the one dispatch this job made. Zero
   * matches within the window returns null, which callers treat as unknown.
   * Several matches are never guessed between.
   */
  async function reconcileDispatch(
    target: CloudflareTarget,
    context: DeploymentContext,
  ): Promise<{ deploymentId: string } | null> {
    if (!context.dispatchedAt) return null
    const since = context.dispatchedAt.getTime() - DISPATCH_CLOCK_SKEW_MS
    const deadline =
      now() + (options.reconciliationTimeoutMs ?? DEFAULT_RECONCILE_TIMEOUT_MS)
    for (;;) {
      const matches = await readWithRetry(() => matchesSince(target, since))
      if (matches.length > 1)
        throw new DeploymentUncertainError(
          `Multiple upstream builds match job=${context.jobId}; manual investigation required`,
        )
      const only = matches[0]
      if (only) return { deploymentId: only }
      const wait = Math.min(
        options.reconciliationPollMs ?? DEFAULT_RECONCILE_POLL_MS,
        deadline - now(),
      )
      if (wait <= 0) return null
      await sleep(wait)
    }
  }

  async function poll(
    target: CloudflareTarget,
    deploymentId: string,
  ): Promise<Poll> {
    if (target.kind === 'pages') {
      const deployment = await client.getPagesDeployment(
        target.projectName,
        deploymentId,
      )
      return pagesPoll(deployment)
    }
    const build = await client.getWorkerBuild(deploymentId)
    return workersPoll(build)
  }

  /** Logs the last lines of a failed build. Never throws. */
  async function logFailureTail(
    target: CloudflareTarget,
    deploymentId: string,
    log: (line: string) => void,
  ) {
    try {
      const lines =
        target.kind === 'pages'
          ? await client.getPagesDeploymentLogs(
              target.projectName,
              deploymentId,
            )
          : await client.getWorkerBuildLogs(deploymentId)
      for (const line of lines.slice(-LOG_TAIL_LINES)) {
        log(`cloudflare: ${line}`)
      }
    } catch {
      log('cloudflare: build logs could not be fetched')
    }
  }

  return {
    async deploy(target, log, context) {
      const cf = requireCloudflare(target)
      log(
        `Deploying ${describeTarget(cf)} job=${context.jobId} publication=${context.publicationId} snapshot=${context.snapshotHash}`,
      )
      let started: string
      try {
        // This POST is deliberately never retried: a lost response or a 5xx
        // can follow queueing the build.
        started = await dispatch(cf)
      } catch (error) {
        if (error instanceof CloudflareApiError && error.notDispatched) {
          throw new DeploymentNotDispatchedError(error.message)
        }
        log(
          'Deploy response uncertain; reconciling the same dispatch before proceeding',
        )
        const found = await reconcileDispatch(cf, context)
        if (!found)
          throw new DeploymentUncertainError(
            `Deployment acceptance unknown for job=${context.jobId} publication=${context.publicationId}; reconcile manually, do not redeploy`,
          )
        log(`upstream deployment=${found.deploymentId}`)
        log(`dashboard ${dashboardUrl(cf, found.deploymentId, accountId)}`)
        return found
      }
      log(`upstream deployment=${started}`)
      log(`dashboard ${dashboardUrl(cf, started, accountId)}`)
      return { deploymentId: started }
    },

    async reconcile(target, context, log) {
      const cf = requireCloudflare(target)
      const found = await reconcileDispatch(cf, context)
      log(
        found
          ? `Reconciled upstream deployment=${found.deploymentId}`
          : `No matching dispatch job=${context.jobId}; acceptance remains unknown`,
      )
      if (found)
        log(`dashboard ${dashboardUrl(cf, found.deploymentId, accountId)}`)
      return found
    },

    async waitForCompletion(target, deploymentId, { timeoutMs, pollMs }, log) {
      const cf = requireCloudflare(target)
      const deadline = now() + timeoutMs
      let lastStatus: string | undefined
      while (now() < deadline) {
        const state = await readWithRetry(() => poll(cf, deploymentId))
        if (state.status !== lastStatus) {
          log(`deployment=${deploymentId} status=${state.status}`)
          lastStatus = state.status
        }
        if (state.state === 'error') {
          await logFailureTail(cf, deploymentId, log)
          return 'error'
        }
        if (state.state === 'done') return 'done'
        const wait = Math.min(pollMs, deadline - now())
        if (wait <= 0) break
        await sleep(wait)
      }
      return 'timeout'
    },

    healthCheck,
  }
}

function requireCloudflare(target: DeploymentTarget): CloudflareTarget {
  if (target.provider !== 'cloudflare') {
    throw new Error('The Cloudflare adapter received a non-Cloudflare target')
  }
  return target
}

function describeTarget(target: CloudflareTarget) {
  return target.kind === 'pages'
    ? `pages project=${target.projectName} branch=${target.branch}`
    : `worker script=${target.scriptName} trigger=${target.triggerUuid} branch=${target.branch}`
}

function dashboardUrl(
  target: CloudflareTarget,
  deploymentId: string,
  accountId: string,
) {
  return target.kind === 'pages'
    ? `${DASHBOARD}/${accountId}/pages/view/${target.projectName}/${deploymentId}`
    : `${DASHBOARD}/${accountId}/workers/services/view/${target.scriptName}/production/builds/${deploymentId}`
}

/** Done when the deploy stage succeeds; any failed or cancelled stage is an error. */
export function pagesPoll(deployment: CloudflarePagesDeployment): Poll {
  const status = `${deployment.latestStage.name ?? 'unknown'}:${deployment.latestStage.status ?? 'unknown'}`
  const stages = [
    ...deployment.stages,
    ...(deployment.latestStage.name && deployment.latestStage.status
      ? [
          {
            name: deployment.latestStage.name,
            status: deployment.latestStage.status,
          },
        ]
      : []),
  ]
  if (
    stages.some(
      (stage) => stage.status === 'failure' || stage.status === 'canceled',
    )
  )
    return { state: 'error', status }
  const deploy =
    deployment.latestStage.name === 'deploy'
      ? deployment.latestStage.status
      : deployment.stages.find((stage) => stage.name === 'deploy')?.status
  if (deploy === 'success') return { state: 'done', status }
  return { state: 'running', status }
}

/** Done only when the build stopped with outcome success. */
export function workersPoll(build: CloudflareWorkerBuild): Poll {
  const status = `${build.status ?? 'unknown'}/${build.buildOutcome ?? 'none'}`
  if (build.status !== 'stopped') return { state: 'running', status }
  return { state: build.buildOutcome === 'success' ? 'done' : 'error', status }
}

function createdSince(createdOn: string | null, sinceMs: number) {
  if (createdOn === null) return false
  const created = Date.parse(createdOn)
  return Number.isFinite(created) && created >= sinceMs
}

/** Retries a read a few times on a transient failure. Never used for writes. */
async function readWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt + 1 >= READ_ATTEMPTS || !isTransient(error)) throw error
      await sleep(100 * 2 ** attempt)
    }
  }
}

function isTransient(error: unknown) {
  if (!(error instanceof CloudflareApiError)) return false
  if (error.notDispatched) return false
  return error.status === null || error.status === 429 || error.status >= 500
}
