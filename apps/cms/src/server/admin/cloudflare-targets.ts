import { collectCloudflareDeployTargets } from '#/adapters/deployment/cloudflare-targets'
import type { CloudflareDeployTargets } from '#/adapters/deployment/cloudflare-targets'

import { getCloudflareClientForOrganization } from './cloudflare-credentials'

type FetchFn = typeof fetch

/**
 * The Pages projects and Workers a client's Cloudflare connection can deploy
 * to. Read-only: it writes no audit entry. Throws the connection's own error
 * (not configured, or Cloudflare refused a call).
 */
export async function listCloudflareDeployTargets(
  organizationId: string,
  options: { fetch?: FetchFn } = {},
): Promise<CloudflareDeployTargets> {
  const client = await getCloudflareClientForOrganization(
    organizationId,
    options,
  )
  return collectCloudflareDeployTargets(client)
}
