import { count, eq } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

import { db } from '#/db'
import { entry } from '#/db/schema'

import type { World } from '../authz-harness'
import type { ActorName, Expected, Policy } from '../authz-policies'

export type Prepared = {
  data: unknown
  /** True while the guarded resource is exactly as seeded (no side effect). */
  untouched?: () => Promise<boolean>
}

/** One matrix row, keyed in its module file by the server fn's export name. */
export type RowSpec = {
  /** Second row for the same fn; the test is named `fnName (variant)`. */
  variant?: string
  policy: Policy
  /** Builds the payload; omitted when the fn takes no input. */
  prepare?: (w: World) => Promise<Prepared> | Prepared
  /** "Who may call" in docs/AUTHZ_MATRIX.md when the policy's default text is not enough. */
  doc?: string
  /**
   * Allowed callers may hit a downstream failure that is not an
   * authorization outcome (SMTP, S3, network, business rules on throwaway
   * data). Denied callers must still be denied.
   */
  tolerant?: boolean
  /**
   * The row is addressed by an object id (site/entry/asset/job/invitation):
   * a caller outside the owning org gets the same NotFound as for a missing
   * id instead of a 403, so ids cannot be probed.
   */
  hidden?: boolean
  /** Per-actor deviations from the policy table. */
  override?: Partial<Record<ActorName, Expected>>
  note?: string
}

/** Every server fn export of a fn module needs a row: a missing or stale key does not compile. */
export type MatrixFor<TModule> = {
  [
    K in keyof TModule as TModule[K] extends (...args: never[]) => unknown
      ? K
      : never
  ]: RowSpec | readonly RowSpec[]
}

export const rowCount = async (table: PgTable, where: SQL | undefined) => {
  const r = (await db.select({ n: count() }).from(table).where(where)).at(0)
  return Number(r?.n ?? 0)
}

export const exists = (table: PgTable, where: SQL | undefined) => async () =>
  (await rowCount(table, where)) > 0
export const absent = (table: PgTable, where: SQL | undefined) => async () =>
  (await rowCount(table, where)) === 0

export const entryUntouched =
  (id: string, expect: Partial<typeof entry.$inferSelect>) => async () => {
    const row = (await db.select().from(entry).where(eq(entry.id, id))).at(0)
    if (!row) return false
    return Object.entries(expect).every(
      ([k, v]) => (row as Record<string, unknown>)[k] === v,
    )
  }

export const uniq = () => crypto.randomUUID().slice(0, 8)

/** A mail draft pointing at a port nothing listens on: fails fast, sends nothing. */
export function unreachableMailDraft() {
  return {
    host: 'localhost',
    port: 1,
    secure: 'none' as const,
    username: null,
    fromAddress: 'cms@areca.test',
    replyTo: null,
  }
}
