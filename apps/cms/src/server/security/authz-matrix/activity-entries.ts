import type * as activityEntriesFns from '#/server/fn/activity-entries'

import type { MatrixFor } from './shared'

export const activityEntriesRows = {
  getActivityEntriesFn: {
    note: 'Missing, foreign and hidden ids are omitted, not refused: the other tenant gets an empty list.',
    hidden: true,
    override: { ownerY: 'allowed' },
    policy: 'org-editor',
    prepare: (w) => ({ data: { ids: [w.X.entry.id] } }),
  },
} satisfies MatrixFor<typeof activityEntriesFns>
