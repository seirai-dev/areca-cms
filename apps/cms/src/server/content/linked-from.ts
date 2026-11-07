import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryLink, site } from '#/db/schema'
import { isEditedSinceReady } from '#/lib/content/edited-since-ready'
import type { EntryStatus } from '#/lib/types'
import { NotFoundError } from './errors.ts'
import { m } from '#/paraglide/messages'
import { localeOf } from '#/server/richtext/section-diff'

import { sectionSnapshotsOf, titleIn } from './section-changes.ts'

/**
 * "Linked from" (docs/design/rich-text-links.md, decision 20): the entries and
 * site content sections whose rich text links to this entry, per language, with
 * the section each link goes to. Reads the link index; a switched-off section
 * is shown to agency admins only.
 */

/** One place a link to this entry sits, and the sections of this entry it goes to. */
export type LinkedFromSource = {
  id: string
  title: string
  slug: string
  collectionKey: string
  collectionLabel: string
  /** `global` for a site content section (its key is `collectionKey`). */
  kind: 'collection' | 'global'
  status: EntryStatus
  publishedSlug: string | null
  scheduledAt: Date | null
  editedSinceReady: boolean
  updatedAt: Date
  /** '' is the whole page; other values are section ids of this entry. */
  sections: { anchor: string; text: string | null }[]
}

export type LinkedFromGroup = {
  /** The language of the links ('' on a single-language site). */
  locale: string
  sources: LinkedFromSource[]
}

/**
 * The linking sources of one entry, grouped by language in the site's language
 * order. A section text is null when the heading no longer exists.
 */
export async function linkedFromEntry(
  targetId: string,
  viewer: { isAgencyAdmin: boolean },
): Promise<LinkedFromGroup[]> {
  const target = (
    await db
      .select({
        siteId: entry.siteId,
        draftData: entry.draftData,
        fields: collection.fields,
        languages: site.languages,
      })
      .from(entry)
      .innerJoin(collection, eq(entry.collectionId, collection.id))
      .innerJoin(site, eq(entry.siteId, site.id))
      .where(eq(entry.id, targetId))
      .limit(1)
  ).at(0)
  if (!target) throw new NotFoundError(m.server_entry_not_found())

  const rows = await db
    .select({
      sourceEntryId: entryLink.sourceEntryId,
      locale: entryLink.locale,
      anchor: entryLink.anchor,
      id: entry.id,
      slug: entry.slug,
      status: entry.status,
      publishedSlug: entry.publishedSlug,
      scheduledAt: entry.scheduledAt,
      updatedAt: entry.updatedAt,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      fields: collection.fields,
      collectionKey: collection.key,
      collectionLabel: collection.label,
      collectionKind: collection.kind,
      collectionEnabled: collection.enabled,
    })
    .from(entryLink)
    .innerJoin(entry, eq(entryLink.sourceEntryId, entry.id))
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .where(
      and(
        eq(entryLink.targetEntryId, targetId),
        eq(entryLink.siteId, target.siteId),
      ),
    )

  const headings = await sectionSnapshotsOf(
    target.draftData,
    target.fields,
    target.languages,
  )
  /** The position and text of a heading of this entry in one language. */
  const headingOf = (locale: string, anchor: string) => {
    for (const [key, list] of Object.entries(headings)) {
      if (localeOf(key) !== locale) continue
      const index = list.findIndex((heading) => heading.id === anchor)
      if (index !== -1) return { index, text: list[index].text }
    }
    return null
  }

  const byLocale = new Map<
    string,
    Map<string, LinkedFromSource & { anchors: Set<string> }>
  >()
  for (const row of rows) {
    if (row.id === targetId) continue
    if (row.collectionKind === 'global' && !row.collectionEnabled) {
      if (!viewer.isAgencyAdmin) continue
    }
    const sources = byLocale.get(row.locale) ?? new Map()
    byLocale.set(row.locale, sources)
    const existing = sources.get(row.id)
    const source =
      existing ??
      ({
        id: row.id,
        title: titleIn({
          data: row.draftData,
          fields: row.fields,
          slug: row.slug,
          locale: row.locale,
          languages: target.languages,
        }),
        slug: row.slug,
        collectionKey: row.collectionKey,
        collectionLabel: row.collectionLabel,
        kind: row.collectionKind,
        status: row.status,
        publishedSlug: row.publishedSlug,
        scheduledAt: row.scheduledAt,
        editedSinceReady: isEditedSinceReady({
          status: row.status,
          draftData: row.draftData,
          publishedData: row.publishedData,
        }),
        updatedAt: row.updatedAt,
        sections: [],
        anchors: new Set<string>(),
      } satisfies LinkedFromSource & { anchors: Set<string> })
    sources.set(row.id, source)
    if (!source.anchors.has(row.anchor)) {
      source.anchors.add(row.anchor)
      const heading =
        row.anchor === '' ? null : headingOf(row.locale, row.anchor)
      source.sections.push({
        anchor: row.anchor,
        text: row.anchor === '' ? null : (heading?.text ?? null),
      })
    }
  }

  const order = target.languages ? target.languages.all : ['']
  const locales = [
    ...order.filter((locale) => byLocale.has(locale)),
    ...[...byLocale.keys()].filter((locale) => !order.includes(locale)),
  ]
  return locales.map((locale) => ({
    locale,
    sources: [...byLocale.get(locale)!.values()]
      .map(({ anchors: _anchors, ...source }) => ({
        ...source,
        sections: [...source.sections].sort(
          (a, b) =>
            sectionRank(locale, a.anchor, headingOf) -
              sectionRank(locale, b.anchor, headingOf) ||
            a.anchor.localeCompare(b.anchor),
        ),
      }))
      .sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
  }))
}

/** Whole page first, then the sections in the order of the page. */
function sectionRank(
  locale: string,
  anchor: string,
  headingOf: (locale: string, anchor: string) => { index: number } | null,
) {
  if (anchor === '') return -1
  return headingOf(locale, anchor)?.index ?? Number.MAX_SAFE_INTEGER
}
