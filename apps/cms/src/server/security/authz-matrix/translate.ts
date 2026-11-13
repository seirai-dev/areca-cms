import type * as translateFns from '#/server/fn/translate'

import type { MatrixFor } from './shared'

export const translateRows = {
  translateContentFn: {
    hidden: true,
    policy: 'org-editor',
    tolerant: true,
    note: 'Same access as generateEntrySeoFn. Allowed callers get a language or AI setup error (no key in the test world); denied callers must not reach the provider.',
    prepare: (w) => ({
      data: { siteId: w.X.site.id, entryId: w.X.entry.id, to: 'nl' },
    }),
  },
} satisfies MatrixFor<typeof translateFns>
