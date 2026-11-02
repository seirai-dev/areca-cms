/**
 * Typed client for the parts of the Cloudflare API that Areca uses: token
 * verification, Pages projects, Workers scripts and Workers Builds triggers.
 * Every call sends a user API token (Workers Builds accepts only user tokens).
 * Shapes Cloudflare documents loosely are mapped defensively; see
 * docs/design/cloudflare-deploy.md for the endpoint table.
 */

export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4'

const REQUEST_TIMEOUT_MS = 15_000
// Cloudflare rejects Pages list requests with per_page above 10 (checked
// live on 2 Nov 2026), so Pages lists page in tens.
const PAGE_SIZE = 10
const MAX_PAGES = 50
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i

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

export type CloudflareWorkerScript = { name: string; tag: string }

export type CloudflareWorkerTrigger = {
  triggerUuid: string | null
  triggerName: string | null
  branchIncludes: string[]
  buildCommand: string | null
  deployCommand: string | null
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
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'CloudflareApiError'
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

function parsePagesProject(raw: unknown): CloudflarePagesProject[] {
  if (!isRecord(raw)) return []
  const name = text(raw.name)
  if (!name) return []
  const sourceType = isRecord(raw.source) ? raw.source.type : undefined
  return [
    {
      name,
      subdomain: text(raw.subdomain) ?? '',
      domains: textArray(raw.domains),
      productionBranch: text(raw.production_branch) ?? '',
      sourceType:
        sourceType === 'github' || sourceType === 'gitlab' ? sourceType : null,
    },
  ]
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

  /** GET one endpoint and return the envelope's `result`. */
  async function get(path: string, label: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    let body: unknown
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          accept: 'application/json',
        },
        redirect: 'error',
        signal: controller.signal,
      })
      body = await response.json().catch(() => null)
    } catch {
      if (controller.signal.aborted) {
        throw new CloudflareApiError(
          `Cloudflare ${label} did not answer within 15 seconds`,
          null,
        )
      }
      throw new CloudflareApiError(
        `Could not reach Cloudflare for ${label}`,
        null,
      )
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok || !isRecord(body) || body.success !== true) {
      const detail = errorMessages(body).join('; ') || 'no details returned'
      throw new CloudflareApiError(
        `Cloudflare ${label} failed (HTTP ${response.status}): ${detail}`,
        response.status,
      )
    }
    return body.result
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
      projects.push(...items.flatMap(parsePagesProject))
      if (items.length < PAGE_SIZE) break
    }
    return projects
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
    verifyToken,
    listPagesProjects,
    listWorkers,
    listWorkerTriggers,
    checkPermissions,
  }
}

export type CloudflareClient = ReturnType<typeof createCloudflareClient>

async function attempt(
  run: () => Promise<CloudflareCheck>,
): Promise<CloudflareCheck> {
  try {
    return await run()
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}
