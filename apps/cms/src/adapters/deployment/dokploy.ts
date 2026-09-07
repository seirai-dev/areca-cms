import type { DeploymentAdapter } from './types'

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
}): DeploymentAdapter {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const fetchFn = opts.fetch ?? fetch

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
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
            : (init.headers as Record<string, string>)
      Object.assign(headers, extra)
    }

    const res = await fetchFn(`${baseUrl}${path}`, { ...init, headers })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(
        `Dokploy ${init.method ?? 'GET'} ${path} failed: ${res.status}${text ? ` ${text}` : ''}`,
      )
    }
    if (!text.trim()) return undefined as T
    return JSON.parse(text) as T
  }

  function getApplication(applicationId: string) {
    return request<DokployApplication>(
      `/api/application.one?applicationId=${encodeURIComponent(applicationId)}`,
    )
  }

  async function bustContentCache(applicationId: string, log: (line: string) => void) {
    const app = await getApplication(applicationId)
    const snapshotId = `${Date.now()}`
    const buildArgs = upsertEnvLine(app.buildArgs, 'ARECA_SNAPSHOT_ID', snapshotId)
    await request('/api/application.saveEnvironment', {
      method: 'POST',
      body: JSON.stringify({
        applicationId,
        env: app.env ?? '',
        buildArgs,
        buildSecrets: app.buildSecrets ?? '',
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
      while (true) {
        try {
          const remaining = Math.max(1, deadline - Date.now())
          const res = await fetchFn(url, {
            signal: AbortSignal.timeout(remaining),
          })
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
  return newest?.deploymentId ?? `${applicationId}-${Date.now()}`
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
