import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

import type { DeploymentAdapter } from './types'
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

export function createDokployAdapter(opts: {
  baseUrl: string
  apiKey: string
  fetch?: FetchFn
  resolveHost?: ResolveHost
  allowInsecureHttp?: boolean
  allowPrivateHealthChecks?: boolean
}): DeploymentAdapter {
  const baseUrl = assertSecureServiceUrl(
    opts.baseUrl,
    opts.allowInsecureHttp,
  ).href.replace(/\/$/, '')
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

    const res = await fetchFn(`${baseUrl}${path}`, { ...init, headers })
    if (!res.ok) {
      throw new Error(
        `Dokploy ${init.method ?? 'GET'} ${path} failed: ${res.status}`,
      )
    }
    const text = await res.text()
    if (!text.trim()) return undefined as T
    return JSON.parse(text) as T
  }

  function getApplication(applicationId: string) {
    return request<DokployApplication>(
      `/api/application.one?applicationId=${encodeURIComponent(applicationId)}`,
    )
  }

  async function bustContentCache(
    applicationId: string,
    log: (line: string) => void,
  ) {
    const app = await getApplication(applicationId)
    const snapshotId = `${Date.now()}`
    const legacySiteToken = readEnvLine(app.buildArgs, 'ARECA_SITE_TOKEN')
    const buildArgs = upsertEnvLine(
      removeEnvLine(app.buildArgs, 'ARECA_SITE_TOKEN'),
      'ARECA_SNAPSHOT_ID',
      snapshotId,
    )
    const buildSecrets = legacySiteToken
      ? upsertEnvLine(app.buildSecrets, 'ARECA_SITE_TOKEN', legacySiteToken)
      : (app.buildSecrets ?? '')
    await request('/api/application.saveEnvironment', {
      method: 'POST',
      body: JSON.stringify({
        applicationId,
        env: app.env ?? '',
        buildArgs,
        buildSecrets,
        createEnvFile: app.createEnvFile ?? false,
      }),
    })
    log(`build arg ARECA_SNAPSHOT_ID=${snapshotId}`)
  }

  return {
    async deploy(target, log) {
      log(`Deploying ${target.applicationId}`)
      await bustContentCache(target.applicationId, log)
      await request('/api/application.deploy', {
        method: 'POST',
        body: JSON.stringify({ applicationId: target.applicationId }),
      })
      const app = await getApplication(target.applicationId)
      return { deploymentId: newestDeploymentId(app, target.applicationId) }
    },

    async waitForCompletion(target, deploymentId, { timeoutMs, pollMs }, log) {
      const started = Date.now()
      const deadline = started + timeoutMs
      let lastStatus: string | undefined
      let seenRunning = false

      while (Date.now() < deadline) {
        const app = await getApplication(target.applicationId)
        const deployment = app.deployments?.find(
          (item) => item.deploymentId === deploymentId,
        )
        const status = deployment?.status ?? app.applicationStatus
        if (status === 'running') seenRunning = true
        if (status !== lastStatus) {
          log(`applicationStatus: ${status}`)
          lastStatus = status
        }
        if (status === 'error') return 'error'
        if (status === 'done' && (deployment || seenRunning)) return 'done'
        if (status === 'idle' && Date.now() - started >= 30_000) return 'error'

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
      : await pinnedRequest(url, resolved.addresses[0], remaining)
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

function pinnedRequest(
  url: URL,
  address: string | undefined,
  timeoutMs: number,
) {
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(
      url,
      {
        signal: AbortSignal.timeout(timeoutMs),
        ...(address
          ? {
              lookup: (_hostname, _options, callback) =>
                callback(null, address, isIP(address)),
            }
          : {}),
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

function newestDeploymentId(
  app: DokployApplication,
  applicationId: string,
): string {
  const deployments = app.deployments
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return `${applicationId}-${Date.now()}`
  }
  const newest = [...deployments].sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  )[0]
  return newest.deploymentId ?? `${applicationId}-${Date.now()}`
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
