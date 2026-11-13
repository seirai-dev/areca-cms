/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import type * as contentFns from '#/server/fn/content'
import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { collection, entry, entryRevision } from '#/db/schema'
import { publishEntry, updateDraft } from '#/server/content/entries'
import { sampleRichText } from '#/server/content/test-utils'

import { absent, entryUntouched, exists, uniq } from './shared'
import type { MatrixFor, RowSpec } from './shared'

/** A fresh draft entry of X that an owner may approve, unpublish, archive or unschedule. */
const ownerEntryAction: RowSpec = {
  hidden: true,
  policy: 'org-owner',
  prepare: async (w) => {
    const e = await w.fresh.entry('X')
    return {
      data: { id: e.id },
      untouched: entryUntouched(e.id, {
        status: 'draft',
        draftVersion: e.draftVersion,
      }),
    }
  },
}

export const contentRows = {
  listCollectionsFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  fieldDataUsageFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id, key: 'articles' } }),
  },
  listEntriesFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({
      data: { siteId: w.X.site.id, collectionKey: 'articles' },
    }),
  },
  listEntryCountsFn: {
    note: 'Non-admins see only enabled collections; the count of a switched-off collection is omitted for them.',
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id } }),
  },
  listRecentEntriesFn: {
    note: 'Overview lists across the site. Non-admins see only entries of enabled collections, the same set as the sidebar.',
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { siteId: w.X.site.id, limit: 8 } }),
  },
  getEntryFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id } }),
  },
  getEntryTitleFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id } }),
  },
  listInboundReferencesFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id } }),
  },
  createEntryFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => {
      const slug = `new-${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          collectionKey: 'articles',
          data: { title: 'New', slug, body: sampleRichText },
        },
        untouched: absent(entry, eq(entry.slug, slug)),
      }
    },
  },
  updateDraftFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: {
          id: e.id,
          data: { title: 'Defaced', slug: e.slug, body: sampleRichText },
          expectedVersion: e.draftVersion,
        },
        untouched: entryUntouched(e.id, { draftVersion: e.draftVersion }),
      }
    },
  },
  publishEntryFn: ownerEntryAction,
  unpublishEntryFn: ownerEntryAction,
  archiveEntryFn: ownerEntryAction,
  cancelScheduleFn: ownerEntryAction,
  scheduleEntryFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: {
          id: e.id,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          timezone: 'UTC',
        },
        untouched: entryUntouched(e.id, { status: 'draft' }),
      }
    },
  },
  deleteEntryFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: { id: e.id },
        untouched: exists(entry, eq(entry.id, e.id)),
      }
    },
  },
  bulkEntryActionFn: {
    hidden: true,
    policy: 'org-owner',
    doc: 'org owner, agency admin (MFA); ready, draft, archive or delete for up to 200 ids of one site, each id with the rules of its single action and its own result (not all-or-nothing)',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      return {
        data: { siteId: w.X.site.id, action: 'archive', ids: [e.id] },
        untouched: entryUntouched(e.id, {
          status: 'draft',
          draftVersion: e.draftVersion,
        }),
      }
    },
  },
  listRevisionsFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { entryId: w.X.entry.id } }),
  },
  restoreRevisionFn: {
    hidden: true,
    policy: 'org-owner',
    prepare: async (w) => {
      const e = await w.fresh.entry('X')
      const [rev] = await db
        .select()
        .from(entryRevision)
        .where(eq(entryRevision.entryId, e.id))
        .limit(1)
      return {
        data: {
          entryId: e.id,
          revisionId: rev?.id ?? 'missing',
          expectedVersion: e.draftVersion,
        },
        untouched: entryUntouched(e.id, { draftVersion: e.draftVersion }),
      }
    },
  },
  getPreviewUrlFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({
      data: {
        siteId: w.X.site.id,
        collection: 'articles',
        slug: w.X.entry.slug,
      },
    }),
  },
  resolvePreviewOwnersFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org editor, org owner, agency admin (MFA); lists only the marked owners that exist on the site and are visible to the caller (archived, foreign-site and disabled-section owners come back null)',
    prepare: (w) => ({
      data: {
        siteId: w.X.site.id,
        owners: [{ entry: w.X.entry.id }],
      },
    }),
  },
  listLinkedFromFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id } }),
  },
  applySectionLinkUpdatesFn: {
    hidden: true,
    policy: 'org-editor',
    prepare: (w) => ({ data: { id: w.X.entry.id, updates: [] } }),
  },
  upsertCollectionFn: {
    policy: 'agency',
    note: 'Schema changes are agency-only; org owners cannot edit their own schema.',
    prepare: (w) => {
      const key = `c${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          key,
          label: 'Injected',
          routePattern: '/injected/$slug',
          fields: [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'slug', label: 'Slug', type: 'slug' },
          ],
        },
        untouched: absent(
          collection,
          and(eq(collection.siteId, w.X.site.id), eq(collection.key, key)),
        ),
      }
    },
  },
  deleteCollectionFn: {
    policy: 'agency',
    prepare: async (w) => {
      const c = await w.fresh.collection('X')
      return {
        data: { siteId: w.X.site.id, key: c.key },
        untouched: exists(collection, eq(collection.id, c.id)),
      }
    },
  },
  // Site content (globals): docs/design/site-content-globals.md, "Server functions".
  listGlobalsFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org editor, org owner, agency admin (MFA); disabled site content only for agency admin',
    prepare: async (w) => {
      await w.fresh.global('X')
      return { data: { siteId: w.X.site.id } }
    },
  },
  getGlobalFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org editor, org owner, agency admin (MFA); disabled site content only for agency admin',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return { data: { siteId: w.X.site.id, key: g.collection.key } }
    },
  },
  getGlobalPreviewUrlFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org editor, org owner, agency admin (MFA); disabled site content only for agency admin',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return { data: { siteId: w.X.site.id, key: g.collection.key } }
    },
  },
  updateGlobalDraftFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org editor, org owner, agency admin (MFA); disabled site content only for agency admin',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return {
        data: {
          siteId: w.X.site.id,
          key: g.collection.key,
          data: { email: 'defaced@x.test' },
          expectedVersion: g.entry.draftVersion,
        },
        untouched: entryUntouched(g.entry.id, {
          draftVersion: g.entry.draftVersion,
        }),
      }
    },
  },
  discardGlobalDraftFn: {
    hidden: true,
    policy: 'org-editor',
    doc: 'org editor, org owner, agency admin (MFA); disabled site content only for agency admin',
    prepare: async (w) => {
      // Discard needs a ready section: publish one, then leave a newer draft.
      const g = await w.fresh.global('X')
      const actor = w.users.ownerX.id
      await updateDraft(
        g.entry.id,
        { email: 'ready@x.test' },
        actor,
        g.entry.draftVersion,
      )
      await publishEntry(g.entry.id, actor)
      await updateDraft(g.entry.id, { email: 'changed@x.test' }, actor, 2)
      return {
        data: { siteId: w.X.site.id, key: g.collection.key },
        untouched: entryUntouched(g.entry.id, { draftVersion: 3 }),
      }
    },
  },
  upsertGlobalFn: {
    policy: 'agency',
    note: 'Section structure is agency-only, like collection schemas.',
    prepare: (w) => {
      const key = `g${uniq()}`
      return {
        data: {
          siteId: w.X.site.id,
          key,
          label: 'Injected',
          fields: [{ key: 'email', label: 'Email', type: 'text' }],
        },
        untouched: absent(
          collection,
          and(eq(collection.siteId, w.X.site.id), eq(collection.key, key)),
        ),
      }
    },
  },
  deleteGlobalFn: {
    policy: 'agency',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return {
        data: { siteId: w.X.site.id, key: g.collection.key },
        untouched: exists(collection, eq(collection.id, g.collection.id)),
      }
    },
  },
  setGlobalEnabledFn: {
    policy: 'agency',
    prepare: async (w) => {
      const g = await w.fresh.global('X')
      return {
        data: { siteId: w.X.site.id, key: g.collection.key, enabled: false },
        untouched: exists(
          collection,
          and(eq(collection.id, g.collection.id), eq(collection.enabled, true)),
        ),
      }
    },
  },
} satisfies MatrixFor<typeof contentFns>
