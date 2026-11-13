import { CloudflareApiError } from './cloudflare-api'
import type {
  CloudflareClient,
  CloudflarePagesDeployment,
  CloudflareWorkerBuild,
} from './cloudflare-api'
import { createHealthChecker } from './health-check'
import type { HealthCheckOptions } from './health-check'
import {
  createdSince,
  dispatchOnce,
  dispatchedSince,
  logReconciled,
  pollUntilMatch,
  waitForDeployment,
} from './dispatch'
import type { DeploymentPoll } from './dispatch'
import { retryTransient, sleep as defaultSleep } from './shared'
import { DeploymentUncertainError } from './types'
import type {
  CloudflarePagesDeploymentTarget,
  CloudflareWorkersDeploymentTarget,
  DeploymentAdapter,
  DeploymentContext,
  DeploymentTarget,
} from './types'

const LOG_TAIL_LINES = 100
const DEFAULT_RECONCILE_TIMEOUT_MS = 30_000
const DEFAULT_RECONCILE_POLL_MS = 1_000
/** Short retry for reads inside reconcile and the failure-log tail, and for the variable write. */
const SHORT_RETRY_DELAYS_MS = [100, 200]
const SNAPSHOT_VARIABLE = 'ARECA_SNAPSHOT_ID'
const DASHBOARD = 'https://dash.cloudflare.com'

export type CloudflareAdapterOptions = HealthCheckOptions & {
  client: CloudflareClient
  accountId: string
  now?: () => Date
  reconciliationTimeoutMs?: number
  reconciliationPollMs?: number
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
}

type CloudflareTarget =
  CloudflarePagesDeploymentTarget | CloudflareWorkersDeploymentTarget

type Poll = DeploymentPoll & { status: string }

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
  const sleep = options.sleep ?? defaultSleep
  const healthCheck = createHealthChecker(options)

  /** Short bounded retry for reads and idempotent writes. Never for a POST. */
  function readWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    return retryTransient(operation, {
      delays: SHORT_RETRY_DELAYS_MS,
      isTransient,
      sleep,
      now,
      deadline: Infinity,
    })
  }

  /**
   * Writes ARECA_SNAPSHOT_ID so the build pulls this publication, as Dokploy's
   * build arg does. Throws on failure; the caller must not dispatch then.
   */
  async function setSnapshotVariable(
    target: CloudflareTarget,
    publicationId: string,
  ): Promise<void> {
    await readWithRetry(() =>
      target.kind === 'pages'
        ? client.setPagesProductionBuildVariable(
            target.projectName,
            SNAPSHOT_VARIABLE,
            publicationId,
          )
        : client.setWorkerBuildVariable(
            target.triggerUuid,
            SNAPSHOT_VARIABLE,
            publicationId,
          ),
    )
  }

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
    const since = dispatchedSince(context)
    if (since === null) return null
    return pollUntilMatch({
      timeoutMs:
        options.reconciliationTimeoutMs ?? DEFAULT_RECONCILE_TIMEOUT_MS,
      pollMs: options.reconciliationPollMs ?? DEFAULT_RECONCILE_POLL_MS,
      now,
      sleep,
      async find() {
        const matches = await readWithRetry(() => matchesSince(target, since))
        if (matches.length > 1)
          throw new DeploymentUncertainError(
            `Multiple upstream builds match job=${context.jobId}; manual investigation required`,
          )
        const only = matches[0]
        return only ? { deploymentId: only } : null
      },
    })
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
      const found = await dispatchOnce(
        {
          describe: describeTarget(cf),
          async prepare() {
            await setSnapshotVariable(cf, context.publicationId)
            log(`build variable ${SNAPSHOT_VARIABLE}=${context.publicationId}`)
          },
          // This POST is deliberately never retried: a lost response or a 5xx
          // can follow queueing the build.
          post: () => dispatch(cf),
          notDispatched: (error) =>
            error instanceof CloudflareApiError && error.notDispatched,
          reconcile: () => reconcileDispatch(cf, context),
        },
        context,
        log,
      )
      log(`dashboard ${dashboardUrl(cf, found.deploymentId, accountId)}`)
      return found
    },

    async reconcile(target, context, log) {
      const cf = requireCloudflare(target)
      const found = await reconcileDispatch(cf, context)
      logReconciled(found, context, log)
      if (found)
        log(`dashboard ${dashboardUrl(cf, found.deploymentId, accountId)}`)
      return found
    },

    waitForCompletion(target, deploymentId, { timeoutMs, pollMs }, log) {
      const cf = requireCloudflare(target)
      return waitForDeployment({
        deploymentId,
        poll: () => poll(cf, deploymentId),
        timeoutMs,
        pollMs,
        now,
        sleep,
        isTransient,
        failureReason,
        log,
        onError: () => logFailureTail(cf, deploymentId, log),
      })
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

/**
 * Whether a failed read or idempotent write is worth retrying. Independent of
 * `notDispatched`, which only classifies the deploy POST.
 */
function isTransient(error: unknown) {
  return error instanceof CloudflareApiError && error.transient
}

function failureReason(error: unknown) {
  return error instanceof CloudflareApiError && error.status !== null
    ? `HTTP ${error.status}`
    : 'no response'
}
