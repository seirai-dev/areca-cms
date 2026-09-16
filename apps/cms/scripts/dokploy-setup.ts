/**
 * Idempotently register a customer site application in Dokploy (git + dockerfile +
 * LAN port + CMS build args). Used when onboarding a new site.
 *
 * Required env:
 *   DOKPLOY_URL
 *   DOKPLOY_API_KEY
 *   DOKPLOY_ENVIRONMENT_ID
 *   GIT_URL
 *   SSH_KEY_ID
 *   SITE_TOKEN
 *   CMS_URL
 *
 * Optional env:
 *   APP_NAME          default acme-demo-site
 *   GIT_BRANCH        default master
 *   GIT_BUILD_PATH    default /
 *   DOCKERFILE        default examples/demo-site/Dockerfile
 *   DOCKER_CONTEXT    default .
 *   PUBLISHED_PORT    default 3101
 *   TARGET_PORT       default 3000
 *   AUTO_DEPLOY       default false
 *   DOKPLOY_ALLOW_INSECURE_HTTP default false (local/LAN testing only)
 */
const required = [
  'DOKPLOY_URL',
  'DOKPLOY_API_KEY',
  'DOKPLOY_ENVIRONMENT_ID',
  'GIT_URL',
  'SSH_KEY_ID',
  'SITE_TOKEN',
  'CMS_URL',
] as const

for (const key of required) {
  if (!process.env[key]?.trim()) {
    throw new Error(`Missing required env: ${key}`)
  }
}

const DOKPLOY_URL = process.env.DOKPLOY_URL!.replace(/\/$/, '')
const API_KEY = process.env.DOKPLOY_API_KEY!
const ENVIRONMENT_ID = process.env.DOKPLOY_ENVIRONMENT_ID!
const GIT_URL = process.env.GIT_URL!
const SSH_KEY_ID = process.env.SSH_KEY_ID!
const SITE_TOKEN = process.env.SITE_TOKEN!
const CMS_URL = process.env.CMS_URL!.replace(/\/$/, '')
const APP_NAME = process.env.APP_NAME?.trim() || 'acme-demo-site'
const GIT_BRANCH = process.env.GIT_BRANCH?.trim() || 'master'
const GIT_BUILD_PATH = process.env.GIT_BUILD_PATH?.trim() || '/'
const DOCKERFILE =
  process.env.DOCKERFILE?.trim() || 'examples/demo-site/Dockerfile'
const DOCKER_CONTEXT = process.env.DOCKER_CONTEXT?.trim() || '.'
const PUBLISHED_PORT = Number(process.env.PUBLISHED_PORT ?? 3101)
const TARGET_PORT = Number(process.env.TARGET_PORT ?? 3000)
const AUTO_DEPLOY = ['1', 'true', 'yes', 'on'].includes(
  (process.env.AUTO_DEPLOY ?? 'false').trim().toLowerCase(),
)
const DOKPLOY_ALLOW_INSECURE_HTTP = ['1', 'true', 'yes', 'on'].includes(
  (process.env.DOKPLOY_ALLOW_INSECURE_HTTP ?? 'false').trim().toLowerCase(),
)

assertSecureUrl('DOKPLOY_URL', DOKPLOY_URL)
assertSecureUrl('CMS_URL', CMS_URL)

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

async function dokploy<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'x-api-key': API_KEY,
    accept: 'application/json',
    ...(init.body ? { 'content-type': 'application/json' } : {}),
  }
  const res = await fetch(`${DOKPLOY_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    throw new Error(
      `Dokploy ${init.method ?? 'GET'} ${path} failed: ${res.status}`,
    )
  }
  const text = await res.text()
  if (!text.trim()) return undefined as T
  return JSON.parse(text) as T
}

type DokployApplication = {
  applicationId: string
  name?: string
  env?: string | null
  buildArgs?: string | null
  buildSecrets?: string | null
  customGitUrl?: string | null
  customGitSSHKeyId?: string | null
  ports?: Array<{
    portId: string
    publishedPort: number
    targetPort: number
    protocol?: string
    publishMode?: string
  }>
}

type Project = {
  environments?: Array<{
    environmentId: string
    applications?: Array<{ applicationId: string; name?: string }>
  }>
}

function envBlock(): string {
  return [
    `PORT=${TARGET_PORT}`,
    `ARECA_CMS_URL=${CMS_URL}`,
    `ARECA_SITE_TOKEN=${SITE_TOKEN}`,
  ].join('\n')
}

function buildSecretsBlock(): string {
  return `ARECA_SITE_TOKEN=${SITE_TOKEN}`
}

function buildArgsBlock(): string {
  return [`ARECA_CMS_URL=${CMS_URL}`, `ARECA_SNAPSHOT_ID=0`].join('\n')
}

async function findExistingApplication(): Promise<string | null> {
  const projects = await dokploy<Project[]>('/api/project.all')
  for (const project of projects) {
    for (const environment of project.environments ?? []) {
      if (environment.environmentId !== ENVIRONMENT_ID) continue
      const match = (environment.applications ?? []).find(
        (app) => app.name === APP_NAME,
      )
      if (match?.applicationId) return match.applicationId
    }
  }
  return null
}

async function main() {
  let applicationId = await findExistingApplication()
  let created = false
  if (!applicationId) {
    const createdApp = await dokploy<DokployApplication>(
      '/api/application.create',
      {
        method: 'POST',
        body: JSON.stringify({
          name: APP_NAME,
          appName: APP_NAME,
          environmentId: ENVIRONMENT_ID,
        }),
      },
    )
    applicationId = createdApp.applicationId
    created = true
  }

  await dokploy('/api/application.saveGitProvider', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      customGitUrl: GIT_URL,
      customGitBranch: GIT_BRANCH,
      customGitBuildPath: GIT_BUILD_PATH,
      customGitSSHKeyId: SSH_KEY_ID,
      watchPaths: [],
    }),
  })

  await dokploy('/api/application.saveBuildType', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      buildType: 'dockerfile',
      dockerfile: DOCKERFILE,
      dockerContextPath: DOCKER_CONTEXT,
      dockerBuildStage: '',
      herokuVersion: null,
      railpackVersion: null,
    }),
  })

  await dokploy('/api/application.saveEnvironment', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      env: envBlock(),
      buildArgs: buildArgsBlock(),
      buildSecrets: buildSecretsBlock(),
      createEnvFile: false,
    }),
  })

  await dokploy('/api/application.update', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      autoDeploy: AUTO_DEPLOY,
      // Host-published ports cannot start-first: the new replica cannot bind.
      updateConfigSwarm: {
        Parallelism: 1,
        Order: 'stop-first',
        FailureAction: 'continue',
      },
    }),
  })

  const app = await dokploy<DokployApplication>(
    `/api/application.one?applicationId=${encodeURIComponent(applicationId)}`,
  )
  const ports = Array.isArray(app.ports)
    ? app.ports
    : app.ports
      ? [app.ports]
      : []
  const existingPort = ports.find(
    (port) =>
      port.publishedPort === PUBLISHED_PORT && port.targetPort === TARGET_PORT,
  )
  let portId = existingPort?.portId ?? null
  if (!portId) {
    const createdPort = await dokploy<{ portId: string }>('/api/port.create', {
      method: 'POST',
      body: JSON.stringify({
        applicationId,
        publishedPort: PUBLISHED_PORT,
        targetPort: TARGET_PORT,
        protocol: 'tcp',
        publishMode: 'host',
      }),
    })
    portId = createdPort.portId
  }

  const result: Json = {
    created,
    applicationId,
    name: APP_NAME,
    sshKeyId: SSH_KEY_ID,
    portId,
    publishedPort: PUBLISHED_PORT,
    targetPort: TARGET_PORT,
    healthCheckUrl: `http://HOST:${PUBLISHED_PORT}/api/health`,
    customGitUrl: app.customGitUrl ?? GIT_URL,
    customGitSSHKeyId: app.customGitSSHKeyId ?? SSH_KEY_ID,
    buildArgsStored: Boolean(app.buildArgs?.includes('ARECA_CMS_URL')),
    siteTokenInBuildArgs: Boolean(app.buildArgs?.includes('ARECA_SITE_TOKEN')),
    buildSecretConfigured: Boolean(app.buildSecrets),
  }
  console.log(JSON.stringify(result, null, 2))
}

await main()

function assertSecureUrl(name: string, rawUrl: string) {
  const url = new URL(rawUrl)
  const local =
    url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && (local || DOKPLOY_ALLOW_INSECURE_HTTP))
  ) {
    throw new Error(
      `${name} must use HTTPS (set DOKPLOY_ALLOW_INSECURE_HTTP=true only for local/LAN testing)`,
    )
  }
}

export {}
