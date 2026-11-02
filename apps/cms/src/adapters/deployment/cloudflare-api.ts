/**
 * Typed client for the parts of the Cloudflare API that Areca uses: token
 * verification, Pages projects and deployments, Workers scripts, and Workers
 * Builds triggers and builds. Every call sends a user API token (Workers
 * Builds accepts only user tokens). Shapes Cloudflare documents loosely are
 * mapped defensively; see docs/design/cloudflare-deploy.md for the endpoint
 * table and cloudflare-api-notes.md for what was verified live.
 */

export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4'

const REQUEST_TIMEOUT_MS = 15_000
// Cloudflare rejects Pages list requests with per_page above 10 (checked
// live on 2 Nov 2026), so Pages lists page in tens.
const PAGE_SIZE = 10
const MAX_PAGES = 50
// Workers Builds lists accept larger pages (50 checked live).
const BUILDS_PAGE_SIZE = 50
const MAX_LOG_PAGES = 50
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i

/**
 * Errors that mean the connection never reached Cloudflare, so the request
 * cannot have been received. Any other failure after sending is uncertain.
 */
const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])

type FetchFn = typeof fetch

export type CloudflareTokenStatus = 'active' | 'disabled' | 'expired'

export type CloudflarePagesProject = {
  name: string
  subdomain: string
  domains: string[]
  productionBranch: string
  /** Null for direct-upload projects, which cannot be rebuilt from git. */
  sourceType: 'github' | 'gitlab' | null
}

export type CloudflarePagesDeployment = {
  id: string
  shortId: string | null
  url: string | null
  environment: 'production' | 'preview' | null
  trigger: {
    type: string | null
    branch: string | null
    commitHash: string | null
  }
  createdOn: string | null
  latestStage: { name: string | null; status: string | null }
  stages: { name: string; status: string }[]
}

export type CloudflareWorkerScript = { name: string; tag: string }

export type CloudflareWorkerTrigger = {
  triggerUuid: string | null
  triggerName: string | null
  branchIncludes: string[]
  buildCommand: string | null
  deployCommand: string | null
  /** Set once the trigger is removed; a deleted trigger cannot build. */
  deletedOn: string | null
}

/**
 * A Workers Builds build. `buildTriggerSource` is `manual` for builds created
 * through the API and `push_event` for git pushes. The create response omits
 * the metadata, so those fields are null until the build is read back.
 */
export type CloudflareWorkerBuild = {
  buildUuid: string
  status: string | null
  buildOutcome: string | null
  createdOn: string | null
  triggerUuid: string | null
  buildTriggerSource: string | null
  branch: string | null
}

export type CloudflareWorkerScriptSubdomain = {
  enabled: boolean
  previewsEnabled: boolean
}

/**
 * Result of `verifyToken`, extended for the checks: `invalid` means Cloudflare
 * rejected the token (401/403), `unknown` means the call itself failed.
 */
export type CloudflareTokenCheck = {
  ok: boolean
  status: CloudflareTokenStatus | 'invalid' | 'unknown'
  expiresOn?: string
  message?: string
}

/**
 * One permission check. `message` carries Cloudflare's own error text when
 * the check failed. `skipped` says why it did not run.
 */
export type CloudflareCheck = {
  ok: boolean
  skipped?: 'token-inactive' | 'no-workers' | 'workers-unavailable'
  count?: number
  message?: string
}

export type CloudflarePermissionChecks = {
  token: CloudflareTokenCheck
  pages: CloudflareCheck
  workersScripts: CloudflareCheck
  workersCi: CloudflareCheck
}

export class CloudflareApiError extends Error {
  /**
   * True only when Cloudflare refused the request, or it never left this
   * server. A write that fails with this flag definitely did not start work.
   */
  readonly notDispatched: boolean

  constructor(
    message: string,
    readonly status: number | null,
    options: { notDispatched?: boolean } = {},
  ) {
    super(message)
    this.name = 'CloudflareApiError'
    this.notDispatched = options.notDispatched ?? false
  }
}

/** Every permission passed. A workers-less account has no CI check to pass. */
export function cloudflareChecksPassed(checks: CloudflarePermissionChecks) {
  return (
    checks.token.ok &&
    checks.pages.ok &&
    checks.workersScripts.ok &&
    (checks.workersCi.ok || checks.workersCi.skipped === 'no-workers')
  )
}

export function isValidCloudflareAccountId(value: string) {
  return ACCOUNT_ID_PATTERN.test(value)
}

export type CloudflareClientOptions = {
  apiToken: string
  accountId: string
  fetch?: FetchFn
  baseUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

/** Cloudflare's `errors[].message` strings, in order. */
function errorMessages(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.errors)) return []
  return body.errors.flatMap((entry) =>
    isRecord(entry) && typeof entry.message === 'string' ? [entry.message] : [],
  )
}

/** A connection failure before any byte reached Cloudflare. */
function neverReached(error: unknown) {
  const cause = isRecord(error) ? error.cause : undefined
  const code = isRecord(cause) ? cause.code : undefined
  return typeof code === 'string' && NOT_SENT_CODES.has(code)
}

function parsePagesProject(raw: unknown): CloudflarePagesProject | null {
  if (!isRecord(raw)) return null
  const name = text(raw.name)
  if (!name) return null
  const source = isRecord(raw.source) ? raw.source : {}
  const sourceConfig = isRecord(source.config) ? source.config : {}
  const sourceType = source.type
  return {
    name,
    subdomain: text(raw.subdomain) ?? '',
    domains: textArray(raw.domains),
    productionBranch:
      text(raw.production_branch) ?? text(sourceConfig.production_branch) ?? '',
    sourceType:
      sourceType === 'github' || sourceType === 'gitlab' ? sourceType : null,
  }
}

function parsePagesDeployment(raw: unknown): CloudflarePagesDeployment | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  if (!id) return null
  const trigger = isRecord(raw.deployment_trigger) ? raw.deployment_trigger : {}
  const metadata = isRecord(trigger.metadata) ? trigger.metadata : {}
  const latest = isRecord(raw.latest_stage) ? raw.latest_stage : {}
  const environment = raw.environment
  return {
    id,
    shortId: text(raw.short_id),
    url: text(raw.url),
    environment:
      environment === 'production' || environment === 'preview'
        ? environment
        : null,
    trigger: {
      type: text(trigger.type),
      branch: text(metadata.branch),
      commitHash: text(metadata.commit_hash),
    },
    createdOn: text(raw.created_on),
    latestStage: { name: text(latest.name), status: text(latest.status) },
    stages: (Array.isArray(raw.stages) ? raw.stages : []).flatMap((stage) =>
      isRecord(stage) && text(stage.name) && text(stage.status)
        ? [{ name: stage.name as string, status: stage.status as string }]
        : [],
    ),
  }
}

function parseWorkerScript(raw: unknown): CloudflareWorkerScript[] {
  if (!isRecord(raw)) return []
  const name = text(raw.id)
  const tag = text(raw.tag)
  return name && tag ? [{ name, tag }] : []
}

function parseWorkerTrigger(raw: unknown): CloudflareWorkerTrigger {
  const record = isRecord(raw) ? raw : {}
  return {
    triggerUuid: text(record.trigger_uuid),
    triggerName: text(record.trigger_name),
    branchIncludes: textArray(record.branch_includes),
    buildCommand: text(record.build_command),
    deployCommand: text(record.deploy_command),
    deletedOn: text(record.deleted_on),
  }
}

function parseWorkerBuild(raw: unknown): CloudflareWorkerBuild | null {
  if (!isRecord(raw)) return null
  const buildUuid = text(raw.build_uuid)
  if (!buildUuid) return null
  const trigger = isRecord(raw.trigger) ? raw.trigger : {}
  const metadata = isRecord(raw.build_trigger_metadata)
    ? raw.build_trigger_metadata
    : {}
  return {
    buildUuid,
    status: text(raw.status),
    buildOutcome: text(raw.build_outcome),
    createdOn: text(raw.created_on),
    triggerUuid: text(trigger.trigger_uuid),
    buildTriggerSource: text(metadata.build_trigger_source),
    branch: text(metadata.branch),
  }
}

function isTokenStatus(value: unknown): value is CloudflareTokenStatus {
  return value === 'active' || value === 'disabled' || value === 'expired'
}

export function createCloudflareClient(options: CloudflareClientOptions) {
  if (!isValidCloudflareAccountId(options.accountId)) {
    throw new Error('Cloudflare account ID must be 32 hexadecimal characters')
  }
  const baseUrl = (options.baseUrl ?? CLOUDFLARE_API_BASE_URL).replace(
    /\/+$/,
    '',
  )
  const fetchFn: FetchFn = options.fetch ?? fetch
  const accountPath = `/accounts/${options.accountId}`

  /**
   * One call to the API. Returns the envelope's `result`. A POST is never
   * retried by this client; its caller decides from `notDispatched`.
   */
  async function call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    label: string,
    body?: FormData | string,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    let parsed: unknown
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          accept: 'application/json',
          ...(typeof body === 'string'
            ? { 'content-type': 'application/json' }
            : {}),
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      })
      parsed = await response.json().catch(() => null)
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CloudflareApiError(
          `Cloudflare ${label} did not answer within 15 seconds`,
          null,
        )
      }
      throw new CloudflareApiError(
        `Could not reach Cloudflare for ${label}`,
        null,
        { notDispatched: neverReached(error) },
      )
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok || !isRecord(parsed) || parsed.success !== true) {
      const detail = errorMessages(parsed).join('; ') || 'no details returned'
      // A 4xx with Cloudflare's own error envelope is a refusal. 408 is a
      // server-side timeout, so it may have started work and stays uncertain.
      const refused =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        isRecord(parsed) &&
        Array.isArray(parsed.errors) &&
        parsed.errors.length > 0
      throw new CloudflareApiError(
        `Cloudflare ${label} failed (HTTP ${response.status}): ${detail}`,
        response.status,
        { notDispatched: refused },
      )
    }
    return parsed.result
  }

  function get(path: string, label: string) {
    return call('GET', path, label)
  }

  async function verifyToken(): Promise<{
    status: CloudflareTokenStatus
    expiresOn?: string
  }> {
    const result = await get('/user/tokens/verify', 'token verification')
    if (!isRecord(result) || !isTokenStatus(result.status)) {
      throw new CloudflareApiError(
        'Cloudflare returned an unexpected token status',
        null,
      )
    }
    const expiresOn = text(result.expires_on)
    return expiresOn
      ? { status: result.status, expiresOn }
      : { status: result.status }
  }

  async function listPagesProjects(): Promise<CloudflarePagesProject[]> {
    const projects: CloudflarePagesProject[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await get(
        `${accountPath}/pages/projects?page=${page}&per_page=${PAGE_SIZE}`,
        'Pages projects',
      )
      const items = Array.isArray(result) ? result : []
      for (const item of items) {
        const project = parsePagesProject(item)
        if (project) projects.push(project)
      }
      if (items.length < PAGE_SIZE) break
    }
    return projects
  }

  async function getPagesProject(
    projectName: string,
  ): Promise<CloudflarePagesProject> {
    const result = await get(
      `${accountPath}/pages/projects/${encodeURIComponent(projectName)}`,
      'Pages project',
    )
    const project = parsePagesProject(result)
    if (!project) {
      throw new CloudflareApiError(
        'Cloudflare returned an invalid Pages project',
        null,
      )
    }
    return project
  }

  /**
   * Starts a git build of `branch`. Sent once, never retried. Cloudflare has
   * no idempotency key, so a second identical POST makes a second build.
   */
  async function createPagesDeployment(
    projectName: string,
    branch: string,
  ): Promise<CloudflarePagesDeployment> {
    const form = new FormData()
    form.append('branch', branch)
    const result = await call(
      'POST',
      `${accountPath}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
      'Pages deployment',
      form,
    )
    return parseRequired(parsePagesDeployment(result), 'Pages deployment')
  }

  async function getPagesDeployment(
    projectName: string,
    deploymentId: string,
  ): Promise<CloudflarePagesDeployment> {
    const result = await get(
      `${accountPath}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`,
      'Pages deployment',
    )
    return parseRequired(parsePagesDeployment(result), 'Pages deployment')
  }

  async function listPagesDeployments(
    projectName: string,
    query: { environment?: 'production' | 'preview' } = {},
  ): Promise<CloudflarePagesDeployment[]> {
    const env = query.environment ? `&env=${query.environment}` : ''
    const result = await get(
      `${accountPath}/pages/projects/${encodeURIComponent(projectName)}/deployments?per_page=${PAGE_SIZE}${env}`,
      'Pages deployments',
    )
    return (Array.isArray(result) ? result : []).flatMap((item) => {
      const deployment = parsePagesDeployment(item)
      return deployment ? [deployment] : []
    })
  }

  /** Build log lines for a Pages deployment, oldest first. */
  async function getPagesDeploymentLogs(
    projectName: string,
    deploymentId: string,
  ): Promise<string[]> {
    const result = await get(
      `${accountPath}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}/history/logs`,
      'Pages deployment logs',
    )
    const data =
      isRecord(result) && Array.isArray(result.data) ? result.data : []
    return data.flatMap((entry) =>
      isRecord(entry) && typeof entry.line === 'string' ? [entry.line] : [],
    )
  }

  async function listWorkers(): Promise<CloudflareWorkerScript[]> {
    const result = await get(
      `${accountPath}/workers/scripts`,
      'Workers scripts',
    )
    return (Array.isArray(result) ? result : []).flatMap(parseWorkerScript)
  }

  async function listWorkerTriggers(
    scriptTag: string,
  ): Promise<CloudflareWorkerTrigger[]> {
    const result = await get(
      `${accountPath}/builds/workers/${encodeURIComponent(scriptTag)}/triggers`,
      'Workers Builds triggers',
    )
    return (Array.isArray(result) ? result : []).map(parseWorkerTrigger)
  }

  /**
   * Queues one build on a trigger for `branch`. Sent once, never retried. The
   * API does not deduplicate: a repeated POST queues another build.
   */
  async function createWorkerBuild(
    triggerUuid: string,
    branch: string,
  ): Promise<CloudflareWorkerBuild> {
    const result = await call(
      'POST',
      `${accountPath}/builds/triggers/${encodeURIComponent(triggerUuid)}/builds`,
      'Workers Builds build',
      JSON.stringify({ branch }),
    )
    return parseRequired(parseWorkerBuild(result), 'Workers Builds build')
  }

  async function getWorkerBuild(
    buildUuid: string,
  ): Promise<CloudflareWorkerBuild> {
    const result = await get(
      `${accountPath}/builds/builds/${encodeURIComponent(buildUuid)}`,
      'Workers Builds build',
    )
    return parseRequired(parseWorkerBuild(result), 'Workers Builds build')
  }

  /** Newest first. Builds of every trigger on the Worker. */
  async function listWorkerBuilds(
    scriptTag: string,
    query: { perPage?: number } = {},
  ): Promise<CloudflareWorkerBuild[]> {
    const perPage = query.perPage ?? BUILDS_PAGE_SIZE
    const result = await get(
      `${accountPath}/builds/workers/${encodeURIComponent(scriptTag)}/builds?per_page=${perPage}`,
      'Workers Builds builds',
    )
    return (Array.isArray(result) ? result : []).flatMap((item) => {
      const build = parseWorkerBuild(item)
      return build ? [build] : []
    })
  }

  /**
   * All log lines of a build, oldest first. Follows the cursor while the
   * response says `truncated`, up to a page cap.
   */
  async function getWorkerBuildLogs(buildUuid: string): Promise<string[]> {
    const lines: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      const result = await get(
        `${accountPath}/builds/builds/${encodeURIComponent(buildUuid)}/logs${query}`,
        'Workers Builds logs',
      )
      if (!isRecord(result)) break
      const rows = Array.isArray(result.lines) ? result.lines : []
      for (const row of rows) {
        if (Array.isArray(row) && typeof row[1] === 'string') lines.push(row[1])
      }
      const next = text(result.cursor)
      if (result.truncated !== true || !next || next === cursor) break
      cursor = next
    }
    return lines
  }

  async function cancelWorkerBuild(
    buildUuid: string,
  ): Promise<CloudflareWorkerBuild> {
    const result = await call(
      'PUT',
      `${accountPath}/builds/builds/${encodeURIComponent(buildUuid)}/cancel`,
      'Workers Builds cancel',
    )
    return parseRequired(parseWorkerBuild(result), 'Workers Builds build')
  }

  /** The account's workers.dev subdomain, or null when none is set. */
  async function getWorkersSubdomain(): Promise<string | null> {
    const result = await get(
      `${accountPath}/workers/subdomain`,
      'workers.dev subdomain',
    )
    return isRecord(result) ? text(result.subdomain) : null
  }

  async function getWorkerScriptSubdomain(
    scriptName: string,
  ): Promise<CloudflareWorkerScriptSubdomain> {
    const result = await get(
      `${accountPath}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`,
      'Worker workers.dev route',
    )
    const record = isRecord(result) ? result : {}
    return {
      enabled: record.enabled === true,
      previewsEnabled: record.previews_enabled === true,
    }
  }

  /** Hostnames of the custom domains routed to a Worker. */
  async function listWorkerDomains(scriptName: string): Promise<string[]> {
    const result = await get(
      `${accountPath}/workers/domains?service=${encodeURIComponent(scriptName)}`,
      'Worker custom domains',
    )
    return (Array.isArray(result) ? result : []).flatMap((item) =>
      isRecord(item) && text(item.hostname) ? [item.hostname as string] : [],
    )
  }

  /**
   * Runs every permission check and reports each one. Only a request that
   * Cloudflare refuses or that never returns is a failure; this never throws
   * for a single failed permission.
   */
  async function checkPermissions(): Promise<CloudflarePermissionChecks> {
    let token: CloudflareTokenCheck
    try {
      const verified = await verifyToken()
      token = {
        ok: verified.status === 'active',
        status: verified.status,
        ...(verified.expiresOn ? { expiresOn: verified.expiresOn } : {}),
      }
    } catch (error) {
      const rejected =
        error instanceof CloudflareApiError &&
        (error.status === 401 || error.status === 403)
      token = {
        ok: false,
        status: rejected ? 'invalid' : 'unknown',
        message: messageOf(error),
      }
    }

    if (!token.ok) {
      return {
        token,
        pages: { ok: false, skipped: 'token-inactive' },
        workersScripts: { ok: false, skipped: 'token-inactive' },
        workersCi: { ok: false, skipped: 'token-inactive' },
      }
    }

    const pages = await attempt(async () => ({
      ok: true,
      count: (await listPagesProjects()).length,
    }))

    let workers: CloudflareWorkerScript[] | null = null
    let workersScripts: CloudflareCheck
    try {
      workers = await listWorkers()
      workersScripts = { ok: true, count: workers.length }
    } catch (error) {
      workersScripts = { ok: false, message: messageOf(error) }
    }

    let workersCi: CloudflareCheck
    if (workers === null) {
      workersCi = { ok: false, skipped: 'workers-unavailable' }
    } else if (workers.length === 0) {
      workersCi = { ok: false, skipped: 'no-workers' }
    } else {
      const [first] = workers
      workersCi = await attempt(async () => ({
        ok: true,
        count: (await listWorkerTriggers(first.tag)).length,
      }))
    }

    return { token, pages, workersScripts, workersCi }
  }

  return {
    accountId: options.accountId,
    verifyToken,
    listPagesProjects,
    getPagesProject,
    createPagesDeployment,
    getPagesDeployment,
    listPagesDeployments,
    getPagesDeploymentLogs,
    listWorkers,
    listWorkerTriggers,
    createWorkerBuild,
    getWorkerBuild,
    listWorkerBuilds,
    getWorkerBuildLogs,
    cancelWorkerBuild,
    getWorkersSubdomain,
    getWorkerScriptSubdomain,
    listWorkerDomains,
    checkPermissions,
  }
}

export type CloudflareClient = ReturnType<typeof createCloudflareClient>

function parseRequired<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new CloudflareApiError(`Cloudflare returned an invalid ${what}`, null)
  }
  return value
}

async function attempt(
  run: () => Promise<CloudflareCheck>,
): Promise<CloudflareCheck> {
  try {
    return await run()
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}
