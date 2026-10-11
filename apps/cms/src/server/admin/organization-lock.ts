/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty; retain defensive lookup and authorization checks. */
import { eq } from 'drizzle-orm'

import type { db } from '#/db'
import { organization } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Lock order: organization, site, then asset/library. */
export async function lockOrganizationForMutation(
  tx: Tx,
  organizationId: string,
) {
  const [found] = await tx
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for('update')
  if (!found) throw new NotFoundError(m.server_organization_not_found())
  return found
}
