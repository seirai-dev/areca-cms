import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry } from '#/db/schema'
import { entryTitle } from '#/lib/content/utils'
import { GLOBAL_ENTRY_SLUG } from '#/lib/globals'

/**
 * Verifies the owners a preview page marks (Visual editor, Decision 15). A
 * marker names an entry by id or a site content section by key. Only owners
 * that really exist on this site, are not archived and are visible to the
 * viewer come back resolved; everything else is null. Plain helpers only: this
 * module is not a server-function module (see `server/fn/content.ts`).
 */

export type PreviewOwner = { entry: string } | { global: string }

export type ResolvedOwner =
  | {
      kind: 'entry'
      entryId: string
      collectionKey: string
      collectionLabel: string
      label: string
    }
  | {
      kind: 'global'
      entryId: string
      globalKey: string
      label: string
    }

/**
 * The camelCase form of a content key, the SDK's rule (`toCamelKey` in
 * `packages/site-sdk/src/camel-case.ts`): `company_info` and `companyInfo`
 * both give `companyInfo`.
 */
function toCamelKey(raw: string): string {
  const [first = '', ...rest] = raw
    .split(/[-_]/)
    .filter((part) => part.length > 0)
  return (
    first + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join('')
  )
}

type Section = { id: string; key: string; label: string; enabled: boolean }

/**
 * The section a marker's key names: an exact key match first, else the same
 * camelCase name (`company_info` marker for `companyInfo`, or the reverse).
 */
function matchSection(sections: Section[], key: string): Section | undefined {
  const exact = sections.find((section) => section.key === key)
  if (exact) return exact
  const camel = toCamelKey(key)
  return sections.find((section) => toCamelKey(section.key) === camel)
}

export async function resolvePreviewOwners(
  siteId: string,
  owners: PreviewOwner[],
  viewer: { isAgencyAdmin: boolean },
): Promise<Array<ResolvedOwner | null>> {
  const entryIds = [
    ...new Set(
      owners.flatMap((owner) => ('entry' in owner ? [owner.entry] : [])),
    ),
  ]
  const globalKeys = [
    ...new Set(
      owners.flatMap((owner) => ('global' in owner ? [owner.global] : [])),
    ),
  ]

  // One query for the entry owners, with their collection.
  const resolvedEntries = new Map<string, ResolvedOwner | null>()
  if (entryIds.length > 0) {
    const rows = await db
      .select({
        entry,
        collection: {
          key: collection.key,
          label: collection.label,
          kind: collection.kind,
          enabled: collection.enabled,
          fields: collection.fields,
        },
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .where(inArray(entry.id, entryIds))
    for (const row of rows) {
      const { entry: found, collection: col } = row
      let resolved: ResolvedOwner | null = null
      const hiddenSection =
        col.kind === 'global' && !col.enabled && !viewer.isAgencyAdmin
      if (
        found.siteId === siteId &&
        found.status !== 'archived' &&
        !hiddenSection
      ) {
        resolved =
          col.kind === 'global'
            ? {
                kind: 'global',
                entryId: found.id,
                globalKey: col.key,
                label: col.label,
              }
            : {
                kind: 'entry',
                entryId: found.id,
                collectionKey: col.key,
                collectionLabel: col.label,
                label: entryTitle(found.draftData, col.fields, found.slug),
              }
      }
      resolvedEntries.set(found.id, resolved)
    }
  }

  // One query for the site's sections, then one for their `$global` entries.
  const resolvedGlobals = new Map<string, ResolvedOwner | null>()
  if (globalKeys.length > 0) {
    const sections: Section[] = await db
      .select({
        id: collection.id,
        key: collection.key,
        label: collection.label,
        enabled: collection.enabled,
      })
      .from(collection)
      .where(and(eq(collection.siteId, siteId), eq(collection.kind, 'global')))

    const matched = new Map<string, Section>()
    for (const key of globalKeys) {
      const section = matchSection(sections, key)
      if (section && (section.enabled || viewer.isAgencyAdmin)) {
        matched.set(key, section)
      }
    }

    const sectionIds = [...new Set([...matched.values()].map((s) => s.id))]
    const globalEntries = new Map<string, string>()
    if (sectionIds.length > 0) {
      const rows = await db
        .select({ id: entry.id, collectionId: entry.collectionId })
        .from(entry)
        .where(
          and(
            inArray(entry.collectionId, sectionIds),
            eq(entry.slug, GLOBAL_ENTRY_SLUG),
          ),
        )
      for (const row of rows) globalEntries.set(row.collectionId, row.id)
    }

    for (const key of globalKeys) {
      const section = matched.get(key)
      const entryId = section ? globalEntries.get(section.id) : undefined
      resolvedGlobals.set(
        key,
        section && entryId
          ? {
              kind: 'global',
              entryId,
              globalKey: section.key,
              label: section.label,
            }
          : null,
      )
    }
  }

  return owners.map((owner) =>
    'entry' in owner
      ? (resolvedEntries.get(owner.entry) ?? null)
      : (resolvedGlobals.get(owner.global) ?? null),
  )
}
