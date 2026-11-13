import type * as assetsFns from '#/server/fn/assets'
import { and, eq } from 'drizzle-orm'
import { asset } from '#/db/schema'

import { exists } from './shared'
import type { MatrixFor } from './shared'

export const assetsRows = {
  listAssetsFn: {
    policy: 'org-editor',
    prepare: (w) => ({
      data: { organizationId: w.X.org.id, limit: 20, offset: 0 },
    }),
  },
  getAssetFn: {
    note: 'Missing and foreign assets both answer null.',
    override: { ownerY: 'allowed' },
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.asset.id } }),
  },
  updateAssetFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: async (w) => {
      const a = await w.fresh.asset('X')
      return {
        data: { id: a.id, altText: 'Changed by caller' },
        untouched: exists(
          asset,
          and(eq(asset.id, a.id), eq(asset.altText, 'original alt')),
        ),
      }
    },
  },
  deleteAssetFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const a = await w.fresh.asset('X')
      return {
        data: { id: a.id },
        untouched: exists(asset, eq(asset.id, a.id)),
      }
    },
  },
} satisfies MatrixFor<typeof assetsFns>
