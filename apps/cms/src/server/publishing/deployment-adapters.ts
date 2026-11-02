import { createCloudflareAdapter } from '#/adapters/deployment/cloudflare'
import type { DeploymentAdapter } from '#/adapters/deployment/types'
import type { DeploymentTarget } from '#/lib/types'
import { env } from '#/env'
import { getCloudflareClientForOrganization } from '#/server/admin/cloudflare-credentials'
import { getDeploymentAdapterForOrganization } from '#/server/admin/dokploy-credentials'

/**
 * The adapter for one site's target, using the client's credentials for that
 * provider. Missing credentials throw a ConflictError before any request.
 */
export async function resolveDeploymentAdapter(
  organizationId: string,
  target: DeploymentTarget,
): Promise<DeploymentAdapter> {
  if (target.provider === 'dokploy') {
    return getDeploymentAdapterForOrganization(organizationId)
  }
  const client = await getCloudflareClientForOrganization(organizationId)
  return createCloudflareAdapter({
    client,
    accountId: client.accountId,
    allowPrivateHealthChecks: env.ALLOW_PRIVATE_HEALTH_CHECKS === 'true',
  })
}
