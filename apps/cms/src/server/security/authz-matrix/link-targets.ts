import type * as linkTargetsFns from '#/server/fn/link-targets'

import type { MatrixFor } from './shared'

export const linkTargetsRows = {
  searchLinkTargetsFn: {
    note: 'Entries a rich text link can point at. Non-admins see only enabled collections, as the sidebar does.',
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({
      data: { siteId: w.X.site.id, query: 'a', locale: null, limit: 5 },
    }),
  },
  linkTargetHeadingsFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({
      data: { siteId: w.X.site.id, entryId: w.X.entry.id, locale: null },
    }),
  },
  checkLinkTargetsFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({
      data: {
        siteId: w.X.site.id,
        locale: null,
        links: [{ entryId: w.X.entry.id, anchor: null }],
      },
    }),
  },
} satisfies MatrixFor<typeof linkTargetsFns>
