import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'

import { db } from '#/db'
import type { DbExecutor, Tx } from '#/db'
import { entry, entryRevision } from '#/db/schema'
import type { AuditMeta, EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit, auditAutosave } from '#/server/audit'

import { lockSiteLinkIndex, syncEntryLinkIndex } from './entry-link-index.ts'
import { ConflictError, NotFoundError, ValidationError } from './errors.ts'
import type { SiteCore } from './site-core.ts'
import { validateContentOwnership } from './validation.ts'

/**
 * The commit path every entry writer shares: one transaction that takes the
 * site's link-index lock first (AGENTS.md), writes the entry row with a new
 * content version, then records the change (link index rows, revision,
 * audit). Each writer keeps its own checks and locks between those steps.
 */

/** The schedule columns of an entry with no schedule. */
export const CLEARED_SCHEDULE = {
  scheduledData: null,
  scheduledSlug: null,
  scheduledVersion: null,
  scheduledAt: null,
  scheduleTimezone: null,
  scheduledBy: null,
} as const

/** The columns an archive writes, next to the content version bump. */
export function archivedColumns(actorId: string, now: Date) {
  return { status: 'archived', updatedBy: actorId, updatedAt: now } as const
}

/**
 * Runs `write` in a transaction whose first statement is the site's link-index
 * lock, so two writes of one site cannot deadlock on the index rows.
 */
export function entryTransaction<T>(
  siteId: string,
  write: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockSiteLinkIndex(tx, siteId)
    return write(tx)
  })
}

/**
 * Updates one entry and moves its content version on. With `expected`, only
 * that draft version is written and a miss is a conflict with its message
 * (the draft moved on); without, a miss means the entry is gone.
 */
export async function updateEntryRow(
  tx: Tx,
  id: string,
  set: PgUpdateSetSource<typeof entry>,
  expected?: { draftVersion: number; conflict: string },
) {
  const updated = (
    await tx
      .update(entry)
      .set({ contentVersion: sql`${entry.contentVersion} + 1`, ...set })
      .where(
        expected
          ? and(eq(entry.id, id), eq(entry.draftVersion, expected.draftVersion))
          : eq(entry.id, id),
      )
      .returning()
  ).at(0)
  if (!updated) {
    if (expected) throw new ConflictError(expected.conflict)
    throw new NotFoundError(m.server_entry_not_found())
  }
  return updated
}

/**
 * Records a committed entry change: its link index rows, a revision of `data`
 * with `note`, and the audit row `entry.<note>`. An autosave records the
 * coalescing autosave audit row instead.
 */
export async function recordEntryChange(
  tx: Tx,
  site: SiteCore,
  change: {
    entryId: string
    actorId: string
    note: string
    data: EntryData
    auditMeta?: AuditMeta
    autosave?: boolean
  },
) {
  await syncEntryLinkIndex(tx, change.entryId)
  await writeRevision(
    change.entryId,
    change.data,
    change.actorId,
    change.note,
    tx,
  )
  if (change.autosave) {
    await auditAutosave(
      {
        organizationId: site.organizationId,
        siteId: site.id,
        actorId: change.actorId,
        entryId: change.entryId,
      },
      tx,
      site,
    )
    return
  }
  await audit(
    {
      organizationId: site.organizationId,
      siteId: site.id,
      actorId: change.actorId,
      action: `entry.${change.note}`,
      targetType: 'entry',
      targetId: change.entryId,
      meta: change.auditMeta,
    },
    tx,
    site,
  )
}

/** Throws unless every asset and reference in `data` belongs to the site. */
export async function assertContentOwnership(
  tx: Tx,
  site: SiteCore,
  fields: Field[],
  data: EntryData,
) {
  const errors = await validateContentOwnership(
    site.id,
    site.organizationId,
    fields,
    data,
    tx,
  )
  if (errors.length) throw new ValidationError(errors)
}

/**
 * A person's autosaves within this window of their last autosave update that
 * one revision instead of adding a row. The window is measured from when that
 * revision was created, so a long session still gets a new row every window.
 */
export const AUTOSAVE_COALESCE_MS = 10 * 60 * 1000

/**
 * Records a revision. An autosave by the same person, when the entry's newest
 * revision is their own autosave within the window, replaces that revision's
 * data. Every other write (approval, schedule, publish, restore, another
 * person's change) adds its own revision, so milestones are never merged.
 */
export async function writeRevision(
  entryId: string,
  data: EntryData,
  actorId: string,
  note: string,
  connection: DbExecutor = db,
) {
  if (note !== 'update') {
    await connection.insert(entryRevision).values({
      entryId,
      data,
      createdBy: actorId,
      note,
      kind: 'milestone',
    })
    return
  }
  // An autosave in one statement: update the newest revision when it is this
  // person's autosave inside the window, otherwise insert a new autosave.
  const windowMs = AUTOSAVE_COALESCE_MS
  await connection.execute(sql`
    with input as (
      select ${JSON.stringify(data)}::jsonb as data
    ),
    latest as (
      select ${entryRevision.id} as id, ${entryRevision.kind} as kind,
        ${entryRevision.createdBy} as created_by,
        ${entryRevision.createdAt} as created_at
      from ${entryRevision}
      where ${entryRevision.entryId} = ${entryId}
      order by ${entryRevision.createdAt} desc, ${entryRevision.id} desc
      limit 1
    ),
    coalesced as (
      update ${entryRevision} set data = (select data from input)
      from latest
      where ${entryRevision.id} = latest.id
        and latest.kind = 'autosave'
        and latest.created_by = ${actorId}
        and latest.created_at >= clock_timestamp() - make_interval(secs => ${windowMs / 1000})
      returning ${entryRevision.id}
    )
    insert into ${entryRevision} (id, entry_id, data, created_by, note, kind)
    select ${randomUUID()}, ${entryId}, (select data from input), ${actorId}, 'update', 'autosave'
    where not exists (select 1 from coalesced)
  `)
}
