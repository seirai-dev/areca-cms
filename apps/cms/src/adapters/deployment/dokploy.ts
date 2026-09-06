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
    if (!res.ok) {
      throw new Error(
        `Dokploy ${init.method ?? 'GET'} ${path} failed: ${res.status}`,
      )
    }
    return (await res.json()) as T
  }

  function getApplication(applicationId: string) {
    return request<DokployApplication>(
      `/api/application.one?applicationId=${encodeURIComponent(applicationId)}`,
    )
  }

  return {
    async deploy(target, log) {
      log(`Deploying ${target.applicationId}`)
      await request('/api/application.deploy', {
        method: 'POST',
        body: JSON.stringify({ applicationId: target.applicationId }),
      })
      const app = await getApplication(target.applicationId)
      return { deploymentId: newestDeploymentId(app, target.applicationId) }
    },

    async waitForCompletion(target, _deploymentId, { timeoutMs, pollMs }, log) {
      const started = Date.now()
      const deadline = started + timeoutMs
      let lastStatus: string | undefined

      while (Date.now() < deadline) {
        const app = await getApplication(target.applicationId)
        const status = app.applicationStatus
        if (status !== lastStatus) {
          log(`applicationStatus: ${status}`)
          lastStatus = status
        }
        if (status === 'done') return 'done'
        if (status === 'error') return 'error'
        if (status === 'idle' && Date.now() - started >= 30_000) return 'error'

        const wait = Math.min(pollMs, deadline - Date.now())
        if (wait <= 0) break
        await sleep(wait)
      }

      return 'timeout'
    },

    async healthCheck(url, { timeoutMs, intervalMs }) {
      const deadline = Date.now() + timeoutMs
      while (true) {
        try {
          const remaining = Math.max(1, deadline - Date.now())
          const res = await fetchFn(url, {
            signal: AbortSignal.timeout(remaining),
          })
          if (res.status === 200) return true
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
}

interface DokployApplication {
  applicationStatus?: string
  deployments?: DokployDeployment[]
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
