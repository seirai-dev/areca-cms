import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createCloudflareAdapter } from './cloudflare'
import {
  CLOUDFLARE_API_BASE_URL,
  createCloudflareClient,
} from './cloudflare-api'
import type { CloudflareWorkersDeploymentTarget } from './types'

/**
 * Live smoke test against a real Cloudflare account. Skipped unless
 * CLOUDFLARE_LIVE_TOKEN_FILE, CLOUDFLARE_LIVE_ACCOUNT_ID and
 * CLOUDFLARE_LIVE_WORKER are set. It only reads the account unless
 * CLOUDFLARE_LIVE_DEPLOY=true, which queues one real production build and
 * waits for it to finish. A deploy also needs CLOUDFLARE_LIVE_PUBLICATION_ID,
 * because the build pulls that publication. Run it by hand, never in CI.
 */
const tokenFile = process.env.CLOUDFLARE_LIVE_TOKEN_FILE
const accountId = process.env.CLOUDFLARE_LIVE_ACCOUNT_ID
const workerName = process.env.CLOUDFLARE_LIVE_WORKER
const deploy = process.env.CLOUDFLARE_LIVE_DEPLOY === 'true'
// The build pulls this publication, so it must be a real release of the site
// the Worker builds (its live one is safe: the site is rebuilt unchanged).
const publicationId = process.env.CLOUDFLARE_LIVE_PUBLICATION_ID
const SNAPSHOT_VARIABLE = 'ARECA_SNAPSHOT_ID'

/** Raw call for the variable checks. Returns `result`; never logs the token. */
async function rawCall(
  apiToken: string,
  method: 'GET' | 'DELETE',
  path: string,
): Promise<unknown> {
  const response = await fetch(`${CLOUDFLARE_API_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
    },
    redirect: 'error',
  })
  const body = (await response.json().catch(() => null)) as {
    success?: boolean
    result?: unknown
  } | null
  if (!response.ok || body?.success !== true) {
    throw new Error(
      `Cloudflare ${method} ${path} failed (HTTP ${response.status})`,
    )
  }
  return body.result
}

describe.skipIf(!tokenFile || !accountId || !workerName)(
  'Cloudflare live smoke test',
  () => {
    it(
      'finds the production trigger and, when asked, deploys and sees done',
      async () => {
        const apiToken = readFileSync(tokenFile ?? '', 'utf8').trim()
        const client = createCloudflareClient({
          apiToken,
          accountId: accountId ?? '',
        })
        const script = (await client.listWorkers()).find(
          (item) => item.name === workerName,
        )
        expect(script, `Worker ${workerName} exists`).toBeDefined()
        if (!script) return
        const trigger = (await client.listWorkerTriggers(script.tag)).find(
          (item) =>
            item.triggerUuid !== null && item.branchIncludes.includes('main'),
        )
        expect(trigger, 'a trigger covers main').toBeDefined()
        if (!trigger?.triggerUuid || !deploy) return
        expect(
          publicationId,
          'CLOUDFLARE_LIVE_PUBLICATION_ID is set for a live deploy',
        ).toBeTruthy()
        if (!publicationId) return

        const target: CloudflareWorkersDeploymentTarget = {
          provider: 'cloudflare',
          kind: 'workers',
          scriptName: script.name,
          scriptTag: script.tag,
          triggerUuid: trigger.triggerUuid,
          branch: 'main',
          healthCheckUrl: 'https://example.invalid/health',
        }
        const adapter = createCloudflareAdapter({
          client,
          accountId: accountId ?? '',
        })
        const log = (line: string) => process.stdout.write(`${line}\n`)
        const context = {
          jobId: `live-${Date.now()}`,
          publicationId,
          snapshotHash: 'live-smoke',
          dispatchedAt: new Date(),
        }
        const variablesPath = `/accounts/${accountId}/builds/triggers/${trigger.triggerUuid}/environment_variables`
        try {
          const { deploymentId } = await adapter.deploy(target, log, context)
          // Recovery after an unclear POST must find exactly this build.
          expect(await adapter.reconcile?.(target, context, log)).toEqual({
            deploymentId,
          })
          expect(
            await adapter.waitForCompletion(
              target,
              deploymentId,
              { timeoutMs: 10 * 60_000, pollMs: 5_000 },
              log,
            ),
          ).toBe('done')
          // The build must have pulled this publication.
          const variables = (await rawCall(
            apiToken,
            'GET',
            variablesPath,
          )) as Record<string, { value?: unknown } | undefined> | null
          expect(variables?.[SNAPSHOT_VARIABLE]?.value).toBe(
            context.publicationId,
          )
        } finally {
          // Always remove the variable so the real Worker is left as it was.
          await rawCall(
            apiToken,
            'DELETE',
            `${variablesPath}/${SNAPSHOT_VARIABLE}`,
          )
        }
      },
      11 * 60_000,
    )
  },
)
