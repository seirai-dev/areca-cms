import { NEVER_APPLIED_ATTENTION } from '#/lib/dev-env'
import type { PlanAttention, PlanItem } from '#/server/dev-env/plan'
import type { SlugCollision } from '#/server/dev-env/slug-collisions'

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

/** Sorted-key JSON. Local, so the client never loads `plan.ts` (it imports node:crypto). */
function fingerprintJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprintJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const members = Object.keys(source)
      .sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${fingerprintJson(source[key])}`)
    return `{${members.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * What a decision was made on: the item's id, kind, production version,
 * attention and summary. A change to any of them means the agency must look
 * again.
 */
export function planItemFingerprint(item: PlanItem): string {
  return fingerprintJson({
    id: item.id,
    kind: item.kind,
    productionContentVersion: item.productionContentVersion ?? null,
    attention: item.attention,
    summary: item.summary,
  })
}

export type CarriedPushDecisions = {
  decisions: PushDecisions
  /** Items that changed (or are new) since the reviewed plan. The screen highlights them. */
  changed: string[]
}

/**
 * Carries the decisions made on the reviewed plan over to a refreshed one. A
 * decision stays only while its item is unchanged; a changed item loses it
 * and is listed in `changed`. Items that left the plan drop out. `reviewed`
 * is null before the first plan is reviewed: nothing has changed then.
 */
export function carryPushDecisions(
  reviewed: readonly PlanItem[] | null,
  next: readonly PlanItem[],
  decisions: PushDecisions,
): CarriedPushDecisions {
  if (reviewed === null) return { decisions, changed: [] }
  const before = new Map(
    reviewed.map((item) => [item.id, planItemFingerprint(item)]),
  )
  const unchanged = new Set<string>()
  const changed: string[] = []
  for (const item of next) {
    if (before.get(item.id) === planItemFingerprint(item)) {
      unchanged.add(item.id)
    } else {
      changed.push(item.id)
    }
  }
  const keep = (ids: readonly string[]) => ids.filter((id) => unchanged.has(id))
  return {
    decisions: {
      unticked: keep(decisions.unticked),
      applied: keep(decisions.applied),
    },
    changed,
  }
}

/**
 * Whether a Needs-attention row may be switched to Apply. A scheduled
 * production entry, or a URL another entry holds, can never be applied: the
 * schedule or the URL must be resolved first. The server enforces the same
 * rule (`selectPlanItems`). Normal rows have no Apply switch: false.
 */
export function applyAllowed(item: PlanItem): boolean {
  return item.attention !== null && !NEVER_APPLIED_ATTENTION.has(item.attention)
}

/** What a Needs-attention row's Skip | Apply switch shows. */
export function decisionOf(
  item: PlanItem,
  decisions: PushDecisions,
): { value: 'skip' | 'apply'; applyDisabled: boolean } {
  const allowed = applyAllowed(item)
  return {
    value: allowed && decisions.applied.includes(item.id) ? 'apply' : 'skip',
    applyDisabled: !allowed,
  }
}

/** Whether a push would write this item, given the decisions. */
export function isPushTaken(item: PlanItem, decisions: PushDecisions): boolean {
  if (item.attention !== null) {
    return applyAllowed(item) && decisions.applied.includes(item.id)
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

/**
 * The row title: `Spring menu · Articles` for an entry, the bare title otherwise.
 * `title` replaces `item.title` when the screen has a translation for it.
 */
export function planItemLabel(
  item: PlanItem,
  title: string = item.title,
): string {
  return item.collectionLabel ? `${title} · ${item.collectionLabel}` : title
}

/** A secondary line a row shows beside its summary or reason. */
export type PushDetail =
  /** Entry rows: fields a pending removal keeps in production. */
  | { kind: 'keeps'; fields: string[] }
  /** Destructive schema items: the production entries they archive. `values` is null when none holds a value. */
  | { kind: 'archives'; values: number | null; entries: number }

/** The detail lines of an item, in display order. */
export function pushDetailsOf(item: PlanItem): PushDetail[] {
  const details: PushDetail[] = []
  const kept = item.summary.preservedFields ?? []
  if (kept.length > 0) details.push({ kind: 'keeps', fields: kept })
  const entries = item.affectedEntries?.length ?? 0
  if (item.kind.startsWith('schema.') && entries > 0) {
    const values = droppedValues(item)
    details.push({
      kind: 'archives',
      values: values > 0 ? values : null,
      entries,
    })
  }
  return details
}

/**
 * What a schema row does, for its title: `Remove field 'excerpt' · Posts`,
 * `Remove collection · Posts`, `Add collection · Case studies`,
 * `Change collection · Posts`. Null for every other row.
 */
export type SchemaAction =
  | { kind: 'add-collection' }
  | { kind: 'remove-collection' }
  | { kind: 'change-collection' }
  /** A field removal that holds production values: the removed field keys. */
  | { kind: 'remove-fields'; fields: string[] }

export function schemaActionOf(item: PlanItem): SchemaAction | null {
  switch (item.kind) {
    case 'schema.add':
      return { kind: 'add-collection' }
    case 'schema.remove':
      return { kind: 'remove-collection' }
    case 'schema.change': {
      const fields = (item.summary.droppedFields ?? []).map(
        (field) => field.key,
      )
      return fields.length > 0
        ? { kind: 'remove-fields', fields }
        : { kind: 'change-collection' }
    }
    default:
      return null
  }
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
  /** A field removal: the fields that hold production values. */
  | { kind: 'drops'; fields: string[] }
  | { kind: 'remove-collection' }
  | { kind: 'main-language'; entries: number }
  /** `titles`: the scheduled production entries a schema item touches. Empty for an entry row. */
  | { kind: 'scheduled'; titles: string[] }
  | { kind: 'deleted-in-production' }
  | { kind: 'slug-taken'; collisions: SlugCollision[] }

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
      // A removed collection has no dropped fields to name; its entries are the detail line.
      if (item.kind === 'schema.remove') return { kind: 'remove-collection' }
      return {
        kind: 'drops',
        fields: (item.summary.droppedFields ?? []).map((field) => field.key),
      }
    case 'main-language':
      return { kind: 'main-language', entries: item.summary.stampCount ?? 0 }
    case 'scheduled':
      return { kind: 'scheduled', titles: item.summary.scheduledTitles ?? [] }
    case 'deleted-in-production':
      return { kind: 'deleted-in-production' }
    case 'slug-taken':
      return {
        kind: 'slug-taken',
        collisions: item.summary.slugCollisions ?? [],
      }
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
