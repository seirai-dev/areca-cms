import type * as overviewFns from '#/server/fn/overview'

import type { MatrixFor } from './shared'

export const overviewRows = {
  getSitesOverviewFn: {
    policy: 'user',
    note: 'Scoped to the caller organizations (all for agency admins); scoping asserted separately.',
    override: { adminNoMfa: 'mfa' },
  },
} satisfies MatrixFor<typeof overviewFns>
