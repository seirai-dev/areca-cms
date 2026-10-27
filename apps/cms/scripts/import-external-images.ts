// Copies external images embedded in existing rich text into each
// organization's media library and points the content at the copies. New
// saves do this automatically; this catches up content written before.
//
//   pnpm assets:import-external [--dry-run]
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { db, pool } from '#/db'
import { collection, entry, site } from '#/db/schema'
import type { EntryData } from '#/lib/types'
import {
  hasExternalImages,
  importExternalImages,
} from '#/server/assets/external-images'
import { assetMutationLock } from '#/server/assets/usage'

const COLUMNS = ['draftData', 'publishedData', 'scheduledData'] as const

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--dry-run')) {
  throw new Error('Usage: import-external-images.ts [--dry-run]')
}
const dryRun = args.includes('--dry-run')

let scanned = 0
let updated = 0
let imported = 0
let skipped = 0
const warnings: string[] = []

try {
  const rows = await db
    .select({ entry, fields: collection.fields, site })
    .from(entry)
    .innerJoin(collection, eq(entry.collectionId, collection.id))
    .innerJoin(site, eq(entry.siteId, site.id))

  for (const row of rows) {
    scanned += 1
    const changes: Partial<Record<(typeof COLUMNS)[number], EntryData>> = {}
    for (const column of COLUMNS) {
      const data = row.entry[column]
      if (!data || !hasExternalImages(row.fields, data)) continue
      if (dryRun) {
        console.log(
          `${row.site.slug}/${row.entry.slug}: ${column} has external images`,
        )
        continue
      }
      const result = await importExternalImages({
        organizationId: row.site.organizationId,
        originSiteId: row.site.id,
        actorId: row.entry.updatedBy ?? row.entry.createdBy ?? null,
        fields: row.fields,
        data,
      })
      warnings.push(
        ...result.warnings.map(
          (warning) => `${row.site.slug}/${row.entry.slug}: ${warning}`,
        ),
      )
      if (result.imported > 0) {
        changes[column] = result.data
        imported += result.imported
      }
    }
    if (Object.keys(changes).length === 0) continue

    // Only write when nobody saved, scheduled or released the entry in the
    // meantime: going live promotes scheduled data without touching
    // updatedAt, so the schedule version and status are checked too.
    const { scheduledVersion } = row.entry
    const written = await db.transaction(async (tx) => {
      await assetMutationLock(tx, row.site.organizationId)
      return tx
        .update(entry)
        .set({
          contentVersion: sql`${entry.contentVersion} + 1`,
          ...changes,
          // A release already building for the old approval must not promote
          // the rewritten data; the scheduler builds the new version instead.
          ...(changes.scheduledData ? { scheduledVersion: randomUUID() } : {}),
        })
        .where(
          and(
            eq(entry.id, row.entry.id),
            eq(entry.draftVersion, row.entry.draftVersion),
            eq(entry.updatedAt, row.entry.updatedAt),
            eq(entry.status, row.entry.status),
            scheduledVersion === null
              ? isNull(entry.scheduledVersion)
              : eq(entry.scheduledVersion, scheduledVersion),
          ),
        )
        .returning({ id: entry.id })
    })
    if (written.length > 0) {
      updated += 1
      console.log(`${row.site.slug}/${row.entry.slug}: updated`)
    } else {
      skipped += 1
      console.log(
        `${row.site.slug}/${row.entry.slug}: changed while importing, run again`,
      )
    }
  }

  for (const warning of warnings) console.warn(warning)
  console.log(
    dryRun
      ? `Scanned ${scanned} entries (dry run, nothing changed).`
      : `Scanned ${scanned} entries: ${updated} updated, ${imported} images now in the media library, ${skipped} skipped, ${warnings.length} images left external.`,
  )
} finally {
  await pool.end()
}
