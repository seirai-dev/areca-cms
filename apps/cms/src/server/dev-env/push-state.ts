/**
 * State shared by the steps of a push (push.ts runs them in order inside one
 * transaction, under the production locks).
 */
import type { Tx } from '#/db'
import type { EntryData, EntryStatus, Field } from '#/lib/types'

import type { PlanInput, PlanItem } from './plan'
import type { DevEnvActor, SiteRow } from './rows'
import type { PushWarning } from './write'

/** A ready version written in pass 2 that still has to pass strict validation. */
export type ReadyCandidate = {
  itemId: string
  entryId: string
  fields: Field[]
  requiredLanguages: string[]
  ready: EntryData
  prev: {
    publishedData: EntryData | null
    publishedSlug: string | null
    publishedAt: Date | null
    status: EntryStatus
  }
  active: boolean
}

export type PushState = {
  tx: Tx
  actor: DevEnvActor
  organizationId: string
  production: SiteRow
  planInput: PlanInput
  warnings: PushWarning[]
  /** Plan item id to the production entry it writes to, resolved in pass 1. */
  targets: Map<string, string>
  /** Plan item id to the production id it wrote to (null for schema and languages). */
  written: Map<string, string | null>
  /** Plan item ids the push writes (selected, after exclusions and decisions). */
  selectedIds: Set<string>
  /** Production entry id to its content_version, for the rows this push locked. */
  lockedVersions: Map<string, number>
}

/**
 * Fields an entry keeps in production: the ones a pending schema removal would
 * delete. Empty when that removal is applied in this push.
 */
export function keptFields(item: PlanItem, selectedIds: Set<string>): string[] {
  const pending = (item.dependsOn ?? []).some((id) => !selectedIds.has(id))
  return pending ? (item.summary.preservedFields ?? []) : []
}
