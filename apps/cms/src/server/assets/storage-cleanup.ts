import { and, eq, isNull, lt, lte, or } from 'drizzle-orm'

import { getStorage } from '#/adapters'
import { db } from '#/db'
import { asset, branding, storageObjectDeletion } from '#/db/schema'
import { redactString } from '#/server/log'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export const STORAGE_RETRY_DELAYS_MS = [60_000, 300_000, 900_000]

export async function queueObjectDeletion(tx: Transaction, storageKey: string) {
  await tx
    .insert(storageObjectDeletion)
    .values({ storageKey })
    .onConflictDoNothing()
}

/** An intent exists before PUT, so process death cannot leave an untracked object. */
export async function beginObjectUpload(storageKey: string) {
  await db
    .insert(storageObjectDeletion)
    .values({ storageKey, nextAttemptAt: new Date(Date.now() + 15 * 60_000) })
}

export async function completeObjectUpload(
  tx: Transaction,
  storageKey: string,
) {
  const intent = (
    await tx
      .select()
      .from(storageObjectDeletion)
      .where(eq(storageObjectDeletion.storageKey, storageKey))
      .for('update')
  ).at(0)
  // Cleanup and registration share this row lock. If cleanup won, abort the
  // owner's transaction rather than attach an object that may be deleting.
  if (!intent || intent.attempts !== 0) {
    throw new Error('Upload expired before registration; please retry')
  }
  await tx
    .delete(storageObjectDeletion)
    .where(eq(storageObjectDeletion.storageKey, storageKey))
}

export async function compensateObjectUpload(storageKey: string) {
  await db
    .update(storageObjectDeletion)
    .set({ nextAttemptAt: null })
    .where(
      and(
        eq(storageObjectDeletion.storageKey, storageKey),
        eq(storageObjectDeletion.attempts, 0),
      ),
    )
  await drainStorageObjectDeletions(1, { storageKey })
}

/** Retry paused work only after an explicit operator request. */
export async function retryPausedStorageDeletions() {
  await db
    .update(storageObjectDeletion)
    .set({ attempts: 0, nextAttemptAt: null, lastError: null })
    .where(eq(storageObjectDeletion.attempts, 4))
}

export async function drainStorageObjectDeletions(
  limit = 100,
  options: { storageKey?: string } = {},
) {
  let removed = 0
  // Claim one object immediately before deleting it. A batch-wide lease would
  // expire for later objects while earlier network requests were still running.
  for (let i = 0; i < limit; i++) {
    const now = new Date()
    const job = await db.transaction(async (tx) => {
      const row = (
        await tx
          .select()
          .from(storageObjectDeletion)
          .where(
            and(
              lt(storageObjectDeletion.attempts, 4),
              or(
                isNull(storageObjectDeletion.nextAttemptAt),
                lte(storageObjectDeletion.nextAttemptAt, now),
              ),
              options.storageKey
                ? eq(storageObjectDeletion.storageKey, options.storageKey)
                : undefined,
            ),
          )
          .orderBy(storageObjectDeletion.createdAt)
          .limit(1)
          .for('update', { skipLocked: true })
      ).at(0)
      if (!row) return null
      // A lost COMMIT response may have committed the upload. Never clean up
      // an object now owned by an asset or the current branding configuration.
      const ownedAsset = (
        await tx
          .select({ id: asset.id })
          .from(asset)
          .where(eq(asset.storageKey, row.storageKey))
          .limit(1)
      ).at(0)
      const ownedBranding = (
        await tx
          .select({ id: branding.id })
          .from(branding)
          .where(
            or(
              eq(branding.logoKey, row.storageKey),
              eq(branding.faviconKey, row.storageKey),
            ),
          )
          .limit(1)
      ).at(0)
      if (ownedAsset || ownedBranding) {
        await tx
          .delete(storageObjectDeletion)
          .where(eq(storageObjectDeletion.storageKey, row.storageKey))
        return { ...row, owned: true }
      }
      const attempts = row.attempts + 1
      await tx
        .update(storageObjectDeletion)
        .set({ attempts, nextAttemptAt: new Date(now.getTime() + 60_000) })
        .where(eq(storageObjectDeletion.storageKey, row.storageKey))
      return { storageKey: row.storageKey, attempts, owned: false }
    })
    if (!job) break
    if (job.owned) continue
    const owned = and(
      eq(storageObjectDeletion.storageKey, job.storageKey),
      eq(storageObjectDeletion.attempts, job.attempts),
    )
    try {
      await getStorage().delete(job.storageKey)
      await db.delete(storageObjectDeletion).where(owned)
      removed++
    } catch (error) {
      const delay = STORAGE_RETRY_DELAYS_MS[job.attempts - 1] as
        number | undefined
      await db
        .update(storageObjectDeletion)
        .set({
          lastError: redactString(
            error instanceof Error ? error.message : String(error),
          ),
          nextAttemptAt:
            delay === undefined ? null : new Date(Date.now() + delay),
        })
        .where(owned)
    }
  }
  return removed
}
