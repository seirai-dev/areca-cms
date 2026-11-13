import type * as homeFns from '#/server/fn/home'

import type { MatrixFor } from './shared'

export const homeRows = {
  getHomeActivityFn: {
    policy: 'user',
    note: 'Scoped like the overview; editors get no audit trail (asserted separately).',
    override: { adminNoMfa: 'mfa' },
  },
} satisfies MatrixFor<typeof homeFns>
