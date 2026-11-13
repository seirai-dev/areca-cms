import type * as pausedJobsFns from '#/server/fn/paused-jobs'

import type { MatrixFor } from './shared'

export const pausedJobsRows = {
  listPausedJobsFn: { policy: 'agency' },
  retryPausedJobFn: {
    policy: 'agency-fresh',
    note: 'An item that is not paused is not reset.',
    prepare: () => ({ data: { kind: 'storage', id: 'no-such-storage-key' } }),
  },
  dismissPausedJobFn: {
    policy: 'agency-fresh',
    note: 'An item that is not paused is not dismissed.',
    prepare: () => ({ data: { kind: 'storage', id: 'no-such-storage-key' } }),
  },
} satisfies MatrixFor<typeof pausedJobsFns>
