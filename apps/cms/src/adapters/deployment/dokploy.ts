import type { LookupAddress, LookupOptions } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

import { DeploymentNotDispatchedError, DeploymentUncertainError } from './types'
import type { DeploymentAdapter, DeploymentContext } from './types'
import { collectSecretValues, redactString } from '#/server/log'
import {
  assertSecureServiceUrl,
  resolveSafeHealthCheckUrl,
} from '#/server/http/outbound-url'
import type { ResolveHost } from '#/server/http/outbound-url'

// Request bodies for later demo-app provisioning: see dokploy-api-notes.md
//
// application.create: { name, environmentId, appName?, description?, serverId? }
// application.saveGithubProvider: { applicationId, repository, owner, branch, buildPath, githubId, triggerType?, enableSubmodules?, watchPaths? }
// application.saveGitProvider (v0.29.12; saveGitProdiver 404s): { applicationId, customGitUrl, customGitBranch, customGitBuildPath, watchPaths, enableSubmodules?, customGitSSHKeyId? }
// application.saveBuildType: { applicationId, buildType: 'dockerfile'|'nixpacks'|..., dockerfile, dockerContextPath, dockerBuildStage, herokuVersion, railpackVersion, publishDirectory?, isStaticSpa? }
// application.saveEnvironment: { applicationId, env, buildArgs, buildSecrets, createEnvFile }
// domain.create: { host, path?, port?, https?, certificateType?, applicationId?, domainType?, ... }

type FetchFn = typeof fetch

/** Tolerated CMS-to-Dokploy clock skew when comparing deployment createdAt. */
const DISPATCH_CLOCK_SKEW_MS = 5_000

type DokployConnectionOptions = {
  baseUrl: string
  apiKey: string
  fetch?: FetchFn
  allowInsecureHttp?: boolean
}

type DokployAdapterOptions = DokployConnectionOptions & {
  resolveHost?: ResolveHost
  allowPrivateHealthChecks?: boolean
  reconciliationTimeoutMs?: number
  reconciliationPollMs?: number
}

class DokployHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function createDokployRequest(opts: DokployConnectionOptions) {
  const baseUrl = assertSecureServiceUrl(
    opts.baseUrl,
    opts.allowInsecureHttp,
  ).href.replace(/\/+$/, '')
  const fetchFn = opts.fetch ?? fetch

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'x-api-key': opts.apiKey,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    }
    if (init.headers) {
      const extra =
        init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : Array.isArray(init.headers)
            ? Object.fromEntries(init.headers)
            : init.headers
      Object.assign(headers, extra)
    }

    let res: Response
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers,
        redirect: 'error',
        signal: init.signal ?? AbortSignal.timeout(15_000),
      })
    } catch (error) {
      throw new Error(
        redactString(error instanceof Error ? error.message : String(error), [
          ...collectSecretValues(),
          opts.apiKey,
        ]),
      )
    }
    if (!res.ok) {
      throw new DokployHttpError(
        `Dokploy ${init.method ?? 'GET'} ${path} failed: ${res.status}`,
        res.status,
      )
    }
    try {
      const text = await res.text()
      if (!text.trim()) return undefined as T
      return JSON.parse(text) as T
    } catch (error) {
      const message = redactString(
        error instanceof Error ? error.message : String(error),
        [...collectSecretValues(), opts.apiKey],
      )
      if (error instanceof SyntaxError) throw new SyntaxError(message)
      throw new Error(message)
    }
  }

  return request
}

export type DokployApplicationSummary = {
  applicationId: string
  name: string
  appName: string | null
  applicationStatus: string | null
}

export async function listDokployApplications(
  opts: DokployConnectionOptions,
): Promise<{ applications: DokployApplicationSummary[]; total: number }> {
  const request = createDokployRequest(opts)
  const applications: DokployApplicationSummary[] = []
  let total = 0

  do {
    const result = await request<unknown>(
      `/api/application.search?limit=100&offset=${applications.length}`,
    )
    if (
      typeof result !== 'object' ||
      result === null ||
      !('items' in result) ||
      !Array.isArray(result.items) ||
      !('total' in result) ||
      typeof result.total !== 'number' ||
      !Number.isInteger(result.total) ||
      result.total < 0
    ) {
      throw new Error('Dokploy application.search returned an invalid response')
    }
    total = result.total
    for (const item of result.items) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('applicationId' in item) ||
        typeof item.applicationId !== 'string' ||
        !('name' in item) ||
        typeof item.name !== 'string'
      ) {
        throw new Error(
          'Dokploy application.search returned an invalid application',
        )
      }
      applications.push({
        applicationId: item.applicationId,
        name: item.name,
        appName:
          'appName' in item && typeof item.appName === 'string'
            ? item.appName
            : null,
        applicationStatus:
          'applicationStatus' in item &&
          typeof item.applicationStatus === 'string'
            ? item.applicationStatus
            : null,
      })
    }
    if (result.items.length === 0 && applications.length < total) {
      throw new Error(
        'Dokploy application.search returned an incomplete response',
      )
    }
  } while (applications.length < total && applications.length < 1_000)

  return { applications, total }
}

export function createDokployAdapter(
  opts: DokployAdapterOptions,
): DeploymentAdapter {
  const request = createDokployRequest(opts)
  const fetchFn = opts.fetch ?? fetch

  function getApplication(applicationId: string) {
    return retrySafe(() =>
      request<DokployApplication>(
        `/api/application.one?applicationId=${encodeURIComponent(applicationId)}`,
      ),
    )
  }

  async function bustContentCache(
    applicationId: string,
    log: (line: string) => void,
    context: DeploymentContext,
  ) {
    const app = await getApplication(applicationId)
    const snapshotId = context.publicationId
    const legacySiteToken = readEnvLine(app.buildArgs, 'ARECA_SITE_TOKEN')
    const buildArgs = upsertEnvLine(
      removeEnvLine(app.buildArgs, 'ARECA_SITE_TOKEN'),
      'ARECA_SNAPSHOT_ID',
      snapshotId,
    )
    const buildSecrets = legacySiteToken
      ? upsertEnvLine(app.buildSecrets, 'ARECA_SITE_TOKEN', legacySiteToken)
      : (app.buildSecrets ?? '')
    await retrySafe(() =>
      request('/api/application.saveEnvironment', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          env: app.env ?? '',
          buildArgs,
          buildSecrets,
          createEnvFile: app.createEnvFile ?? false,
        }),
      }),
    )
    log(`build arg ARECA_SNAPSHOT_ID=${snapshotId}`)
  }

  return {
    async deploy(target, log, context) {
      log(
        `Deploying application=${target.applicationId} job=${context.jobId} publication=${context.publicationId} snapshot=${context.snapshotHash}`,
      )
      try {
        await bustContentCache(target.applicationId, log, context)
      } catch (error) {
        throw new DeploymentNotDispatchedError(
          error instanceof Error ? error.message : String(error),
        )
      }
      try {
        // This POST is deliberately never retried: a lost response or even an
        // upstream 5xx can follow enqueueing the deployment.
        await request('/api/application.deploy', {
          method: 'POST',
          body: JSON.stringify({
            applicationId: target.applicationId,
            ...dispatchIdentity(context),
          }),
        })
      } catch (error) {
        if (
          error instanceof DokployHttpError &&
          [400, 401, 403, 404, 422].includes(error.status)
        ) {
          throw new DeploymentNotDispatchedError(error.message)
        }
        log(
          'Deploy response uncertain; reconciling the same dispatch before proceeding',
        )
      }
      const found = await reconcile(target.applicationId, context, log)
      if (!found)
        throw new DeploymentUncertainError(
          `Deployment acceptance unknown for job=${context.jobId} publication=${context.publicationId}; reconcile manually, do not redeploy`,
        )
      log(`upstream deployment=${found.deploymentId}`)
      return found
    },

    async reconcile(target, context, log) {
      const found = await reconcile(target.applicationId, context, log)
      log(
        found
          ? `Reconciled upstream deployment=${found.deploymentId}`
          : `No matching dispatch job=${context.jobId}; acceptance remains unknown`,
      )
      return found
    },

    async waitForCompletion(target, deploymentId, { timeoutMs, pollMs }, log) {
      const deadline = Date.now() + timeoutMs
      let lastStatus: string | undefined
      while (Date.now() < deadline) {
        const app = await getApplication(target.applicationId)
        const deployment = app.deployments?.find(
          (item) => item.deploymentId === deploymentId,
        )
        const status = deployment?.status
        if (status !== lastStatus) {
          log(`deployment=${deploymentId} status=${status ?? 'unknown'}`)
          lastStatus = status
        }
        if (status === 'error') return 'error'
        if (status === 'done') return 'done'
        // Application-wide status belongs to no particular dispatch. Missing
        // deployment records are uncertain, never evidence of success/failure.
        const wait = Math.min(pollMs, deadline - Date.now())
        if (wait <= 0) break
        await sleep(wait)
      }
      return 'timeout'
    },

    async healthCheck(url, { timeoutMs, intervalMs, expectPublicationId }) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        try {
          const res = await fetchHealthUrl(url, deadline)
          if (res.status === 200) {
            if (!expectPublicationId) return true
            const body = (await res.json()) as { publicationId?: string }
            if (body.publicationId === expectPublicationId) return true
          }
        } catch {
          // retry until timeout
        }
        const wait = Math.min(intervalMs, deadline - Date.now())
        if (wait <= 0) return false
        await sleep(wait)
      }
    },
  }

  async function reconcile(
    applicationId: string,
    context: DeploymentContext,
    log: (line: string) => void,
  ) {
    const deadline = Date.now() + (opts.reconciliationTimeoutMs ?? 30_000)
    const identity = dispatchIdentity(context)
    for (;;) {
      const app = await getApplication(applicationId)
      const deployments = app.deployments ?? []
      // Preferred evidence: the exact identity we sent. Git-sourced apps make
      // Dokploy ignore title/description, so this only matches other providers.
      const matches = deployments.filter(
        (item) =>
          item.title === identity.title &&
          item.description === identity.description,
      )
      if (matches.length > 1)
        throw new DeploymentUncertainError(
          `Multiple upstream deployments match job=${context.jobId}; manual investigation required`,
        )
      const id = matches[0]?.deploymentId
      if (id) {
        log(`deployment=${id} matched by dispatch title`)
        return { deploymentId: id }
      }
      // Fallback: Dokploy ignored our identity. Builds for an application are
      // serialised by the worker, so the single deployment created since our
      // dispatch is ours. The health check still verifies the publicationId.
      const created = findDeploymentsCreatedSince(deployments, context)
      if (created.length > 1)
        throw new DeploymentUncertainError(
          `Multiple upstream deployments were created after dispatch for job=${context.jobId}; manual investigation required`,
        )
      const onlyCreated = created[0]?.deploymentId
      if (onlyCreated) {
        log(
          `deployment=${onlyCreated} matched as the only deployment created after dispatch`,
        )
        return { deploymentId: onlyCreated }
      }
      const wait = Math.min(
        opts.reconciliationPollMs ?? 1000,
        deadline - Date.now(),
      )
      if (wait <= 0) return null
      await sleep(wait)
    }
  }

  async function fetchHealthUrl(
    rawUrl: string,
    deadline: number,
    redirects = 0,
  ): Promise<Response> {
    const resolved = await resolveSafeHealthCheckUrl(rawUrl, {
      resolve: opts.resolveHost,
      allowInsecureHttp: opts.allowInsecureHttp,
      allowPrivateNetwork: opts.allowPrivateHealthChecks,
    })
    const { url } = resolved
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Health-check timeout')
    const response = opts.fetch
      ? await fetchFn(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(remaining),
        })
      : await pinnedRequest(url, resolved.addresses, remaining)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects >= 4) return response
      return fetchHealthUrl(
        new URL(location, url).href,
        deadline,
        redirects + 1,
      )
    }
    return response
  }
}

/**
 * Connects only to the addresses that were checked for being public, so DNS
 * cannot change between the check and the connection. Exported for tests.
 */
export function pinnedRequest(
  url: URL,
  addresses: string[],
  timeoutMs: number,
) {
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(
      url,
      {
        signal: AbortSignal.timeout(timeoutMs),
        ...(addresses.length > 0 ? { lookup: pinnedLookup(addresses) } : {}),
      },
      (incoming) => {
        const chunks: Buffer[] = []
        let size = 0
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > 64 * 1024) {
            request.destroy(new Error('Health-check response is too large'))
            return
          }
          chunks.push(chunk)
        })
        incoming.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 500,
              headers: incoming.headers as Record<string, string>,
            }),
          )
        })
      },
    )
    request.on('error', reject)
    request.end()
  })
}

interface DokployDeployment {
  deploymentId?: string
  title?: string
  description?: string
  createdAt?: string
  status?: string
}

interface DokployApplication {
  applicationStatus?: string
  deployments?: DokployDeployment[]
  env?: string | null
  buildArgs?: string | null
  buildSecrets?: string | null
  createEnvFile?: boolean | null
}

function upsertEnvLine(
  raw: string | null | undefined,
  key: string,
  value: string,
): string {
  const lines = (raw ?? '').split(/\r?\n/).filter((line) => line.length > 0)
  const index = lines.findIndex((line) => line.startsWith(`${key}=`))
  if (index >= 0) lines[index] = `${key}=${value}`
  else lines.push(`${key}=${value}`)
  return lines.join('\n')
}

function removeEnvLine(raw: string | null | undefined, key: string) {
  return (raw ?? '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith(`${key}=`))
    .join('\n')
}

function readEnvLine(raw: string | null | undefined, key: string) {
  const line = (raw ?? '')
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}=`))
  return line?.slice(key.length + 1)
}

function dispatchIdentity(context: DeploymentContext) {
  return {
    title: `areca:${context.jobId}`,
    description: `publication=${context.publicationId} snapshot=${context.snapshotHash}`,
  }
}

/**
 * Deployments created at or after the dispatch (minus clock skew between the
 * CMS and Dokploy) that do not carry any CMS `areca:` dispatch title. Entries
 * without a parseable createdAt are ignored. Empty when no dispatch time is
 * known, which disables the fallback.
 */
function findDeploymentsCreatedSince(
  deployments: DokployDeployment[],
  context: DeploymentContext,
) {
  if (!context.dispatchedAt) return []
  const since = context.dispatchedAt.getTime() - DISPATCH_CLOCK_SKEW_MS
  return deployments.filter((item) => {
    if (!item.deploymentId) return false
    if (item.title?.startsWith('areca:')) return false
    if (typeof item.createdAt !== 'string') return false
    const created = Date.parse(item.createdAt)
    return Number.isFinite(created) && created >= since
  })
}

/** Bounded retry only for read operations or an identical idempotent write. */
async function retrySafe<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (
        attempt >= 2 ||
        (error instanceof DokployHttpError &&
          ![408, 429, 500, 502, 503, 504].includes(error.status)) ||
        error instanceof SyntaxError
      )
        throw error
      await sleep(100 * 2 ** attempt)
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * A `lookup` that answers with the pinned addresses. Node (22+) asks with
 * `{ all: true }` for Happy Eyeballs and then needs the whole list, not a
 * single address; answering with one address fails every connection.
 */
function pinnedLookup(addresses: string[]) {
  const records = addresses.map((address) => ({
    address,
    family: isIP(address),
  }))
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    const family =
      options.family === 4 || options.family === 6 ? options.family : undefined
    const pool = family
      ? records.filter((record) => record.family === family)
      : records
    const first = pool.at(0)
    if (!first) {
      callback(
        Object.assign(new Error('No pinned address for this address family'), {
          code: 'ENOTFOUND',
        }),
        '',
      )
      return
    }
    if (options.all) callback(null, pool)
    else callback(null, first.address, first.family)
  }
}
