import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createCloudflareAdapter } from './cloudflare'
import { createCloudflareClient } from './cloudflare-api'
import type { CloudflareWorkersDeploymentTarget } from './types'

/**
 * Live smoke test against a real Cloudflare account. Skipped unless
 * CLOUDFLARE_LIVE_TOKEN_FILE, CLOUDFLARE_LIVE_ACCOUNT_ID and
 * CLOUDFLARE_LIVE_WORKER are set. It only reads the account unless
 * CLOUDFLARE_LIVE_DEPLOY=true, which queues one real production build and
 * waits for it to finish. Run it by hand, never in CI.
 */
const tokenFile = process.env.CLOUDFLARE_LIVE_TOKEN_FILE
const accountId = process.env.CLOUDFLARE_LIVE_ACCOUNT_ID
const workerName = process.env.CLOUDFLARE_LIVE_WORKER
const deploy = process.env.CLOUDFLARE_LIVE_DEPLOY === 'true'

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
          publicationId: 'live-smoke',
          snapshotHash: 'live-smoke',
          dispatchedAt: new Date(),
        }
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
      },
      11 * 60_000,
    )
  },
)
