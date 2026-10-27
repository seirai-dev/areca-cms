import type { PlanAttention, PlanItem } from '#/server/dev-env/plan'

/**
 * Pure rules behind the push screen (docs/design/dev-environments.md, "Push
 * screen"): which group a row sits in, what is ticked, what the button says,
 * and which short summary or reason a row shows. The screen turns these
 * descriptors into paraglide strings, so the rules stay unit-tested.
 */

export type PushGroupKey =
  'attention' | 'schema' | 'languages' | 'new' | 'changed' | 'archived'

/** Display order of the groups. Empty groups are not shown. */
export const PUSH_GROUP_ORDER: readonly PushGroupKey[] = [
  'attention',
  'schema',
  'languages',
  'new',
  'changed',
  'archived',
]

export type PushGroup = { key: PushGroupKey; items: PlanItem[] }

/** The group an item is listed in. Anything needing attention goes first. */
export function pushGroupOf(item: PlanItem): PushGroupKey {
  if (item.attention !== null) return 'attention'
  switch (item.kind) {
    case 'schema.add':
    case 'schema.change':
    case 'schema.remove':
      return 'schema'
    case 'languages':
      return 'languages'
    case 'entry.new':
      return 'new'
    case 'entry.change':
      return 'changed'
    case 'entry.archive':
      return 'archived'
  }
}

/** Non-empty groups, in display order, each keeping the plan's item order. */
export function groupPushItems(items: readonly PlanItem[]): PushGroup[] {
  const buckets = new Map<PushGroupKey, PlanItem[]>()
  for (const item of items) {
    const key = pushGroupOf(item)
    const bucket = buckets.get(key) ?? []
    bucket.push(item)
    buckets.set(key, bucket)
  }
  return PUSH_GROUP_ORDER.flatMap((key) => {
    const group = buckets.get(key)
    return group ? [{ key, items: group }] : []
  })
}

/**
 * What the agency decided on the screen. `unticked` holds normal rows the
 * agency unticked (all ticked by default). `applied` holds Needs-attention
 * rows switched to Apply (Skip by default).
 */
export type PushDecisions = {
  unticked: readonly string[]
  applied: readonly string[]
}

export const NO_PUSH_DECISIONS: PushDecisions = { unticked: [], applied: [] }

/** Whether a push would write this item, given the decisions. */
export function isPushTaken(item: PlanItem, decisions: PushDecisions): boolean {
  if (item.attention !== null) {
    // A scheduled production entry can never be applied (Decision 15).
    return item.attention !== 'scheduled' && decisions.applied.includes(item.id)
  }
  return !decisions.unticked.includes(item.id)
}

export type PushSelection = {
  /** Every item the push must not write. Sent as `exclude`. */
  exclude: string[]
  /** Needs-attention items the push writes. Sent as `apply`. */
  apply: string[]
  /** Items the push writes: the count on the button. */
  push: number
  /** Items the push leaves alone: the "skipped" count on the button. */
  skipped: number
}

export function pushSelection(
  items: readonly PlanItem[],
  decisions: PushDecisions,
): PushSelection {
  const exclude: string[] = []
  const apply: string[] = []
  let push = 0
  for (const item of items) {
    if (isPushTaken(item, decisions)) {
      push += 1
      if (item.attention !== null) apply.push(item.id)
    } else {
      exclude.push(item.id)
    }
  }
  return { exclude, apply, push, skipped: items.length - push }
}

/** Toggle one id in a decision list, keeping it duplicate-free. */
export function withId(list: readonly string[], id: string, on: boolean) {
  const rest = list.filter((entry) => entry !== id)
  return on ? [...rest, id] : rest
}

/* ------------------------------------------------------------------------
   Row text: descriptors the screen translates
------------------------------------------------------------------------ */

export type ScopeKind = 'ready' | 'draft' | 'both'

/** The row title: `Spring menu · Articles` for an entry, the bare title otherwise. */
export function planItemLabel(item: PlanItem): string {
  return item.collectionLabel
    ? `${item.title} · ${item.collectionLabel}`
    : item.title
}

export type PushSummary =
  | { kind: 'fields'; fields: number; scope: ScopeKind | null }
  | { kind: 'plain' }
  | { kind: 'archive' }
  | { kind: 'new' }
  | { kind: 'schema-add' }
  | { kind: 'schema-remove' }
  | { kind: 'drops'; values: number }
  | { kind: 'languages' }

/** The one-line summary of a normal row. */
export function summarizePushItem(item: PlanItem): PushSummary {
  switch (item.kind) {
    case 'entry.change': {
      const scope = scopeOf(item)
      const fields = item.summary.changedFields?.length ?? 0
      if (fields === 0 && scope === null) return { kind: 'plain' }
      return { kind: 'fields', fields, scope }
    }
    case 'entry.archive':
      return { kind: 'archive' }
    case 'entry.new':
      return { kind: 'new' }
    case 'schema.add':
      return { kind: 'schema-add' }
    case 'schema.change': {
      const fields = item.summary.changedFields?.length ?? 0
      return fields === 0
        ? { kind: 'plain' }
        : { kind: 'fields', fields, scope: null }
    }
    case 'schema.remove': {
      const values = droppedValues(item)
      return values > 0 ? { kind: 'drops', values } : { kind: 'schema-remove' }
    }
    case 'languages':
      return { kind: 'languages' }
  }
}

/** Ready and draft flags of an entry change, as the summary words them. */
export function scopeOf(item: PlanItem): ScopeKind | null {
  const { readyChanged, draftChanged } = item.summary
  if (readyChanged && draftChanged) return 'both'
  if (readyChanged) return 'ready'
  if (draftChanged) return 'draft'
  return null
}

/** Number of production values a schema removal drops. */
export function droppedValues(item: PlanItem): number {
  return (item.summary.droppedFields ?? []).reduce(
    (total, field) => total + field.values,
    0,
  )
}

export type AttentionReason =
  | { kind: 'conflict' }
  | { kind: 'drops'; fields: string[]; values: number }
  | { kind: 'main-language'; entries: number }
  | { kind: 'scheduled' }
  | { kind: 'deleted-in-production' }

/**
 * Why a Needs-attention row is listed. Null for items that need no attention.
 */
export function attentionReasonOf(item: PlanItem): AttentionReason | null {
  const attention: PlanAttention = item.attention
  switch (attention) {
    case null:
      return null
    case 'conflict':
      return { kind: 'conflict' }
    case 'drops-content':
      return {
        kind: 'drops',
        fields: (item.summary.droppedFields ?? []).map((field) => field.key),
        values: droppedValues(item),
      }
    case 'main-language':
      return { kind: 'main-language', entries: item.summary.stampCount ?? 0 }
    case 'scheduled':
      return { kind: 'scheduled' }
    case 'deleted-in-production':
      return { kind: 'deleted-in-production' }
  }
}

/* ------------------------------------------------------------------------
   Plurals
------------------------------------------------------------------------ */

/**
 * Which paraglide variant a count uses. Keys come in `_one` and `_other`
 * pairs, and only exactly one is the singular.
 */
export function pluralForm(count: number): 'one' | 'other' {
  return count === 1 ? 'one' : 'other'
}
