import { and, eq, inArray, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, entryLink, site } from '#/db/schema'
import { baseLocale } from '#/lib/content-locale'
import { isEditedSinceReady } from '#/lib/content/edited-since-ready'
import { entryTitle } from '#/lib/content/utils'
import type { EntryData, EntryStatus, Field, SiteLanguages } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { remapSectionLinks } from '#/server/richtext/entry-links'
import type { SectionChange } from '#/server/richtext/section-diff'
import { localeOf } from '#/server/richtext/section-diff'

import { writeRevision } from './entries.ts'
import { lockSiteLinkIndex, syncEntryLinkIndex } from './entry-link-index.ts'
import { mapRichTextValues } from './entry-links.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import { localeCtxFor } from './locale-validation.ts'
import { sectionSnapshotsOf, titleIn } from './section-changes.ts'

/**
 * Section links after a heading changed (docs/design/rich-text-links.md,
 * decisions 21 and 22): who is shown as linking to a changed heading, and the
 * bulk update that points those links at the new section. Both read the link
 * index, so a link is found the way "Linked from" finds it.
 */

/** What the caller may do with the entries of a site. */
export type SectionViewer = { isOwner: boolean; isAgencyAdmin: boolean }

/** An entry that links to a changed section. The status fields feed its pill. */
export type SectionLinker = {
  id: string
  title: string
  slug: string
  collectionKey: string
  status: EntryStatus
  publishedSlug: string | null
  scheduledAt: Date | null
  editedSinceReady: boolean
  updatedAt: Date
  /** The language of the link. */
  locale: string
  /**
   * True when this caller's update sends the entry back to draft for an owner
   * to approve (see `needsApproval`).
   */
  needsApproval: boolean
}

/** A changed heading and the entries that link to it. */
export type SectionChangeWithLinks = SectionChange & {
  linkers: SectionLinker[]
}

/** One requested rewrite: links to `from` in `locale` move to `to` ('' is the page). */
export type SectionLinkUpdate = { locale: string; from: string; to: string }

/** The key of one link target in an update map. */
function updateKey(locale: string, from: string) {
  return `${locale}|${from}`
}

/**
 * An owner's update is the mechanical fix: the draft, the approved version and
 * the schedule all point at the new section, and the status stays. An editor's
 * update changes the draft only. A ready or scheduled entry then reads as edited
 * since ready and needs an owner to approve it again, so the approved version
 * and the schedule ship unchanged until then (decision 21).
 */
export function needsApproval(
  source: { status: EntryStatus },
  viewer: SectionViewer,
): boolean {
  if (viewer.isOwner) return false
  return source.status === 'published' || source.status === 'scheduled'
}

type SourceRow = {
  id: string
  siteId: string
  slug: string
  status: EntryStatus
  publishedSlug: string | null
  scheduledAt: Date | null
  updatedAt: Date
  draftData: EntryData
  publishedData: EntryData | null
  scheduledData: EntryData | null
  fields: Field[]
  languages: SiteLanguages | null
  collectionKey: string
  collectionKind: 'collection' | 'global'
  collectionEnabled: boolean
  organizationId: string
  environment: string
}

async function readSources(
  connection: Pick<typeof db, 'select'>,
  ids: string[],
  lock: boolean,
): Promise<SourceRow[]> {
  if (ids.length === 0) return []
  const base = connection
    .select({
      id: entry.id,
      siteId: entry.siteId,
      slug: entry.slug,
      status: entry.status,
      publishedSlug: entry.publishedSlug,
      scheduledAt: entry.scheduledAt,
      updatedAt: entry.updatedAt,
      draftData: entry.draftData,
      publishedData: entry.publishedData,
      scheduledData: entry.scheduledData,
      fields: collection.fields,
      languages: site.languages,
      collectionKey: collection.key,
      collectionKind: collection.kind,
      collectionEnabled: collection.enabled,
      organizationId: site.organizationId,
      environment: site.environment,
    })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .innerJoin(site, eq(entry.siteId, site.id))
    .where(inArray(entry.id, ids))
    .orderBy(entry.id)
  return lock ? base.for('no key update', { of: entry }) : base
}

/**
 * Whether a listed source is shown to this caller. A switched-off section is
 * hidden from everyone but agency admins, as everywhere else in the CMS.
 */
function visibleTo(
  source: { collectionKind: string; collectionEnabled: boolean },
  viewer: SectionViewer,
) {
  return (
    viewer.isAgencyAdmin ||
    source.collectionKind !== 'global' ||
    source.collectionEnabled
  )
}

/**
 * The entries whose links point at a changed heading, grouped under each
 * change. A change with no linking entry is left out. Entries of the target's
 * site only, as the link index holds them; a switched-off section is shown to
 * agency admins only.
 */
export async function attachSectionLinkers(
  targetId: string,
  changes: SectionChange[],
  viewer: SectionViewer,
): Promise<SectionChangeWithLinks[]> {
  if (changes.length === 0) return []
  const target = (
    await db
      .select({ siteId: entry.siteId })
      .from(entry)
      .where(eq(entry.id, targetId))
      .limit(1)
  ).at(0)
  if (!target) return []
  const froms = [...new Set(changes.map((change) => change.from))]
  const rows = await db
    .select({
      sourceEntryId: entryLink.sourceEntryId,
      locale: entryLink.locale,
      anchor: entryLink.anchor,
    })
    .from(entryLink)
    .where(
      and(
        eq(entryLink.targetEntryId, targetId),
        eq(entryLink.siteId, target.siteId),
        inArray(entryLink.anchor, froms),
      ),
    )
  const sources = new Map(
    (
      await readSources(
        db,
        [...new Set(rows.map((row) => row.sourceEntryId))],
        false,
      )
    )
      .filter((source) => visibleTo(source, viewer))
      .map((source) => [source.id, source]),
  )

  const out: SectionChangeWithLinks[] = []
  for (const change of changes) {
    const linkers = new Map<string, SectionLinker>()
    for (const row of rows) {
      if (row.anchor !== change.from || row.locale !== change.locale) continue
      const source = sources.get(row.sourceEntryId)
      if (!source || linkers.has(source.id)) continue
      linkers.set(source.id, {
        id: source.id,
        title: titleIn({
          data: source.draftData,
          fields: source.fields,
          slug: source.slug,
          locale: change.locale,
          languages: source.languages,
        }),
        slug: source.slug,
        collectionKey: source.collectionKey,
        status: source.status,
        publishedSlug: source.publishedSlug,
        scheduledAt: source.scheduledAt,
        editedSinceReady: isEditedSinceReady({
          status: source.status,
          draftData: source.draftData,
          publishedData: source.publishedData,
        }),
        updatedAt: source.updatedAt,
        locale: change.locale,
        needsApproval: needsApproval(source, viewer),
      })
    }
    if (linkers.size === 0) continue
    out.push({
      ...change,
      linkers: [...linkers.values()].sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
    })
  }
  return out
}

/** The new data of one JSON column, or null when it holds no link to change. */
async function remapData(
  data: EntryData | null,
  source: Pick<SourceRow, 'fields' | 'languages'>,
  targetId: string,
  updates: Map<string, string>,
): Promise<{ data: EntryData; changed: boolean } | null> {
  if (data === null) return null
  const ctx = source.languages
    ? localeCtxFor(source.languages, source.fields)
    : null
  let changed = false
  const next = await mapRichTextValues(data, source.fields, (json, slot) => {
    const locale = slot.locale ?? (ctx ? baseLocale(data, ctx) : '')
    const result = remapSectionLinks(json, targetId, (anchor) =>
      updates.get(updateKey(locale, anchor)),
    )
    if (result.changed) changed = true
    return result.json
  })
  return { data: next, changed }
}

/**
 * Points the links to changed sections at their new sections, in the draft and
 * in the approved and scheduled versions, in one transaction. The rules
 * (docs/design/rich-text-links.md, decision 21):
 *
 * - an owner's update changes the draft, the approved version and the schedule;
 *   the status and the approval time stay, so the link fix does not change what
 *   is ready;
 * - an editor's update changes the draft only (see `needsApproval`);
 * - each updated entry gets a revision ("Section link updated") and its link
 *   index rows, and its draft version moves on so an open editor reloads.
 *
 * The link-index lock is taken first (see `lockSiteLinkIndex`).
 */
export async function applySectionLinkUpdates(input: {
  targetId: string
  actorId: string
  viewer: SectionViewer
  updates: SectionLinkUpdate[]
}): Promise<{ updated: { id: string; title: string }[] }> {
  const target = (await readSources(db, [input.targetId], false)).at(0)
  if (!target) throw new NotFoundError(m.server_entry_not_found())

  const headings = await sectionSnapshotsOf(
    target.draftData,
    target.fields,
    target.languages,
  )
  const updates = new Map<string, string>()
  for (const update of input.updates) {
    if (!/^[a-z0-9-]+$/.test(update.from)) {
      throw new ValidationError([
        { path: '', message: m.server_section_link_heading_missing() },
      ])
    }
    const present = new Set<string>()
    for (const [key, list] of Object.entries(headings)) {
      if (localeOf(key) !== update.locale) continue
      for (const heading of list) present.add(heading.id)
    }
    if (update.to !== '' && !present.has(update.to)) {
      throw new ValidationError([
        { path: '', message: m.server_section_link_heading_missing() },
      ])
    }
    if (update.to !== update.from) {
      updates.set(updateKey(update.locale, update.from), update.to)
    }
  }
  if (updates.size === 0) return { updated: [] }
  const froms = [...new Set(input.updates.map((update) => update.from))]

  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, target.siteId)
    const linking = await tx
      .select({ sourceEntryId: entryLink.sourceEntryId })
      .from(entryLink)
      .where(
        and(
          eq(entryLink.targetEntryId, input.targetId),
          eq(entryLink.siteId, target.siteId),
          inArray(entryLink.anchor, froms),
        ),
      )
    // Locked and read in the transaction, so the rows stay as read until it ends.
    const sources = await readSources(
      tx,
      [...new Set(linking.map((row) => row.sourceEntryId))],
      true,
    )

    const updated: { id: string; title: string }[] = []
    const owner = input.viewer.isOwner
    for (const source of sources) {
      if (!visibleTo(source, input.viewer)) continue
      const draft = await remapData(
        source.draftData,
        source,
        input.targetId,
        updates,
      )
      // An editor's change reaches the draft only (see `needsApproval`).
      const published = owner
        ? await remapData(source.publishedData, source, input.targetId, updates)
        : null
      const scheduled = owner
        ? await remapData(source.scheduledData, source, input.targetId, updates)
        : null
      const changed =
        draft?.changed === true ||
        published?.changed === true ||
        scheduled?.changed === true
      if (!changed || !draft) continue
      const title = entryTitle(draft.data, source.fields, source.slug)

      const now = new Date()
      await tx
        .update(entry)
        .set({
          draftData: draft.data,
          ...(published?.changed ? { publishedData: published.data } : {}),
          ...(scheduled?.changed ? { scheduledData: scheduled.data } : {}),
          draftVersion: sql`${entry.draftVersion} + 1`,
          contentVersion: sql`${entry.contentVersion} + 1`,
          updatedBy: input.actorId,
          updatedAt: now,
        })
        .where(eq(entry.id, source.id))
      await writeRevision(
        source.id,
        draft.data,
        input.actorId,
        'section-links',
        tx,
      )
      await syncEntryLinkIndex(tx, source.id)
      await audit(
        {
          organizationId: source.organizationId,
          siteId: source.siteId,
          actorId: input.actorId,
          action: 'entry.section_links_update',
          targetType: 'entry',
          targetId: source.id,
        },
        tx,
        { id: source.siteId, environment: source.environment },
      )
      updated.push({ id: source.id, title })
    }
    return { updated }
  })
}
