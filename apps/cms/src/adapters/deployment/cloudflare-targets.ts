import type {
  CloudflareClient,
  CloudflarePagesProject,
  CloudflareWorkerScript,
  CloudflareWorkerTrigger,
} from './cloudflare-api'

/**
 * Lists the Cloudflare projects a site can deploy to, for the Deployment tab.
 * Kept free of the database so the grouping and the trigger rules can be
 * tested on a mocked Cloudflare client. The server wrapper that loads the
 * client's stored token lives in `server/admin/cloudflare-targets.ts`.
 */

/** Workers' detail calls (triggers, domains, routes) run this many at a time. */
export const CLOUDFLARE_TARGET_CONCURRENCY = 4

const HEALTH_PATH = '/api/health'
const WILDCARD_BRANCH = '*'
const PREVIEW_DEPLOY = /\bwrangler\s+versions\s+upload\b/i

export type CloudflareDisabledReason = 'no_git' | 'no_builds'

/** A Workers Builds trigger that deploys exactly one branch. */
export type CloudflareBuildTrigger = {
  triggerUuid: string
  name: string | null
  branch: string
  /** True for `wrangler versions upload` triggers, which never go live. */
  preview: boolean
}

export type CloudflareDeployTarget = {
  kind: 'pages' | 'workers'
  name: string
  /** Workers only: the tag that identifies the Worker. */
  scriptTag: string | null
  /** Pages: `production_branch`. Workers: the branch of the auto-picked trigger. */
  productionBranch: string | null
  /** The first custom domain, else the workers.dev or pages.dev address. */
  primaryDomain: string | null
  suggestedHealthUrl: string | null
  buildable: boolean
  disabledReason: CloudflareDisabledReason | null
  /** Workers only: the triggers that can deploy one branch. Empty for Pages. */
  triggers: CloudflareBuildTrigger[]
  /** Workers only: the trigger chosen without asking, or null. */
  autoTriggerUuid: string | null
}

export type CloudflareDeployTargets = {
  pages: CloudflareDeployTarget[]
  workers: CloudflareDeployTarget[]
  fetchedAt: string
}

export type CloudflareTargetClient = Pick<
  CloudflareClient,
  | 'listPagesProjects'
  | 'listWorkers'
  | 'listWorkerTriggers'
  | 'getWorkersSubdomain'
  | 'getWorkerScriptSubdomain'
  | 'listWorkerDomains'
>

export function suggestedHealthUrl(domain: string | null) {
  return domain ? `https://${domain}${HEALTH_PATH}` : null
}

/** A trigger that runs `wrangler versions upload` only publishes a preview. */
export function isPreviewDeployCommand(command: string | null) {
  return PREVIEW_DEPLOY.test(command ?? '')
}

/**
 * The triggers a site can use: not deleted, and naming exactly one branch
 * (the wildcard is ignored). Triggers without a UUID are dropped too.
 */
export function usableBuildTriggers(
  triggers: CloudflareWorkerTrigger[],
): CloudflareBuildTrigger[] {
  return triggers.flatMap((trigger) => {
    if (!trigger.triggerUuid || trigger.deletedOn) return []
    const branches = trigger.branchIncludes.filter(
      (branch) => branch !== WILDCARD_BRANCH && branch.trim() !== '',
    )
    if (branches.length !== 1) return []
    return [
      {
        triggerUuid: trigger.triggerUuid,
        name: trigger.triggerName,
        branch: branches[0],
        preview: isPreviewDeployCommand(trigger.deployCommand),
      },
    ]
  })
}

/**
 * The trigger picked without asking. A single usable trigger always is. With
 * several, the one production trigger is picked when exactly one is not a
 * preview; otherwise the admin chooses.
 */
export function autoPickTrigger(
  triggers: CloudflareBuildTrigger[],
): CloudflareBuildTrigger | null {
  if (triggers.length === 1) return triggers[0]
  const production = triggers.filter((trigger) => !trigger.preview)
  return production.length === 1 ? production[0] : null
}

/** Runs `fn` over `items` with at most `limit` calls in flight. Keeps order. */
export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length)
  let next = 0
  let failed = false
  const runner = async () => {
    while (!failed && next < items.length) {
      const index = next
      next += 1
      try {
        results[index] = await fn(items[index])
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    runner(),
  )
  await Promise.all(runners)
  return results
}

function pagesTarget(project: CloudflarePagesProject): CloudflareDeployTarget {
  const primaryDomain = project.domains[0] ?? (project.subdomain || null)
  const buildable = project.sourceType !== null
  return {
    kind: 'pages',
    name: project.name,
    scriptTag: null,
    productionBranch: project.productionBranch || null,
    primaryDomain,
    suggestedHealthUrl: suggestedHealthUrl(primaryDomain),
    buildable,
    disabledReason: buildable ? null : 'no_git',
    triggers: [],
    autoTriggerUuid: null,
  }
}

async function workerTarget(
  client: CloudflareTargetClient,
  script: CloudflareWorkerScript,
  accountSubdomain: string | null,
): Promise<CloudflareDeployTarget> {
  const triggers = usableBuildTriggers(
    await client.listWorkerTriggers(script.tag),
  )
  const customDomains = await client.listWorkerDomains(script.name)
  let primaryDomain = customDomains[0] ?? null
  if (!primaryDomain && accountSubdomain) {
    const route = await client.getWorkerScriptSubdomain(script.name)
    if (route.enabled)
      primaryDomain = `${script.name}.${accountSubdomain}.workers.dev`
  }
  const auto = autoPickTrigger(triggers)
  const buildable = triggers.length > 0
  return {
    kind: 'workers',
    name: script.name,
    scriptTag: script.tag,
    productionBranch: auto?.branch ?? null,
    primaryDomain,
    suggestedHealthUrl: suggestedHealthUrl(primaryDomain),
    buildable,
    disabledReason: buildable ? null : 'no_builds',
    triggers,
    autoTriggerUuid: auto?.triggerUuid ?? null,
  }
}

/**
 * Reads the Pages projects and Workers of one Cloudflare account. Only
 * Workers need per-item calls, which run `CLOUDFLARE_TARGET_CONCURRENCY` at a
 * time. Any failed call fails the whole list, so the admin sees one error.
 */
export async function collectCloudflareDeployTargets(
  client: CloudflareTargetClient,
  options: { now?: Date; concurrency?: number } = {},
): Promise<CloudflareDeployTargets> {
  const [projects, scripts] = await Promise.all([
    client.listPagesProjects(),
    client.listWorkers(),
  ])
  const accountSubdomain =
    scripts.length > 0 ? await client.getWorkersSubdomain() : null
  const workers = await mapWithConcurrency(
    [...scripts].sort((a, b) => a.name.localeCompare(b.name)),
    options.concurrency ?? CLOUDFLARE_TARGET_CONCURRENCY,
    (script) => workerTarget(client, script, accountSubdomain),
  )
  return {
    pages: projects
      .map(pagesTarget)
      .sort((a, b) => a.name.localeCompare(b.name)),
    workers,
    fetchedAt: (options.now ?? new Date()).toISOString(),
  }
}
