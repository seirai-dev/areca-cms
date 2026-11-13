/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { eq } from 'drizzle-orm'

import type { Tx } from '#/db'
import { organization } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'

/**
 * `update` (FOR UPDATE) is the default. `no-key-update` (FOR NO KEY UPDATE)
 * still conflicts with every other organization lock, but lets the foreign-key
 * checks of an audit insert (KEY SHARE) run. The development-environment paths
 * use it, see docs/design/dev-environments.md, "Locking and concurrency".
 */
export type OrganizationLockMode = 'update' | 'no-key-update'

/** Lock order: organization, site, then asset/library. */
export async function lockOrganizationForMutation(
  tx: Tx,
  organizationId: string,
  options: { mode?: OrganizationLockMode } = {},
) {
  const [found] = await tx
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for(options.mode === 'no-key-update' ? 'no key update' : 'update')
  if (!found) throw new NotFoundError(m.server_organization_not_found())
  return found
}
