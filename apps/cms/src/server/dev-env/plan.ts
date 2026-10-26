/**
 * Push plan (docs/design/dev-environments.md, "Plan (diff) computation").
 *
 * Pure: takes plain data that `load-plan.ts` reads from the database and
 * returns the items the push screen lists, plus the plan hash that a push must
 * echo back. No database imports, so every rule is unit-tested here.
 */
import { createHash } from 'node:crypto'

import type {
  ContentKind,
  EntryData,
  EntryOriginBaseline,
  EntryStatus,
  Field,
  SchemaSnapshot,
  SchemaSnapshotItem,
} from '#/lib/types'

export type PlanItemKind =
  | 'schema.add'
  | 'schema.change'
  | 'schema.remove'
  | 'languages'
  | 'entry.new'
  | 'entry.change'
  | 'entry.archive'

export type PlanAttention =
  | 'conflict'
  | 'drops-content'
  | 'main-language'
  | 'scheduled'
  | 'deleted-in-production'
  | null

export type PlanSummary = {
  /** Field keys that differ between the baseline and dev (entries), or whose definition differs (schema). */
  changedFields?: string[]
  readyChanged?: boolean
  draftChanged?: boolean
  /** Fields the item removes that hold production values, with the number of entries holding one. */
  droppedFields?: { key: string; values: number }[]
  /** Entries a main-language change stamps in production. */
  stampCount?: number
}

export type PlanItem = {
  /** Stable id: `schema:<key>`, `languages`, or `entry:<devId>`. */
  id: string
  kind: PlanItemKind
  label: string
  collectionKey: string | null
  /** Dev entry id, for entry items. */
  devId?: string
  summary: PlanSummary
  devChanged: boolean
  productionChanged: boolean
  attention: PlanAttention
  /** Production entry the item writes to, when it exists. */
  productionId?: string
  /** Production `content_version` the plan saw for that entry. */
  productionContentVersion?: number
}

export type Plan = { items: PlanItem[]; planHash: string }

export type PlanEntry = {
  id: string
  collectionKey: string
  collectionKind: ContentKind
  slug: string
  status: EntryStatus
  draftData: EntryData
  publishedSlug: string | null
  publishedData: EntryData | null
  originEntryId: string | null
  originBaseline: EntryOriginBaseline | null
  originContentVersion: number | null
}

export type PlanProductionEntry = {
  id: string
  collectionKey: string
  collectionKind: ContentKind
  slug: string
  contentVersion: number
  status: EntryStatus
  /** True when the production entry has a scheduled version. */
  scheduled: boolean
}

export type PlanInput = {
  /** `site.schema_baseline` of the dev env. Null is treated as an empty schema. */
  base: SchemaSnapshot | null
  dev: SchemaSnapshot
  production: SchemaSnapshot
  devEntries: PlanEntry[]
  productionEntries: PlanProductionEntry[]
  /** Production entries holding a value for each field, by collection key then field key. */
  productionFieldUsage: Record<string, Record<string, number>>
  /** Production entries a main-language change would stamp. */
  stampCount: number
}

const EMPTY_SCHEMA: SchemaSnapshot = { languages: null, collections: [] }

/** Deterministic JSON: object keys sorted, undefined members dropped. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = sortKeys(source[key])
    }
    return out
  }
  return value
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function findByKey<T extends { key: string }>(
  rows: T[],
  key: string,
): T | undefined {
  return rows.find((row) => row.key === key)
}

function uniqueSorted(keys: string[]): string[] {
  return [...new Set(keys)].sort()
}

/** Field keys whose definition differs between two field lists (added, removed or changed). */
function changedFieldKeys(before: Field[], after: Field[]): string[] {
  const keys = uniqueSorted([
    ...before.map((field) => field.key),
    ...after.map((field) => field.key),
  ])
  return keys.filter((key) => {
    const a = before.find((field) => field.key === key)
    const b = after.find((field) => field.key === key)
    return !deepEqual(a, b)
  })
}

/** Top-level keys whose values differ, `$i18n` and `$seo` included as whole keys. */
function changedDataKeys(before: EntryData, after: EntryData): string[] {
  const keys = uniqueSorted([...Object.keys(before), ...Object.keys(after)])
  return keys.filter((key) => !deepEqual(before[key], after[key]))
}

/** Production values of the fields the dev side removes, in field order. */
function droppedFields(
  productionFields: Field[],
  devFields: Field[],
  usage: Record<string, number>,
): { key: string; values: number }[] {
  const kept = new Set(devFields.map((field) => field.key))
  return productionFields
    .filter((field) => !kept.has(field.key))
    .map((field) => ({ key: field.key, values: usage[field.key] ?? 0 }))
    .filter((drop) => drop.values > 0)
}

function schemaLabel(kind: PlanItemKind, def: SchemaSnapshotItem): string {
  const noun = def.kind === 'global' ? 'section' : 'collection'
  const verb =
    kind === 'schema.add'
      ? 'Add'
      : kind === 'schema.remove'
        ? 'Remove'
        : 'Change'
  return `${verb} ${noun} "${def.label}"`
}

type Built = {
  item: PlanItem
  /** Values the item was planned from; part of the plan hash. */
  fingerprint: unknown
}

function schemaItems(input: PlanInput, base: SchemaSnapshot): Built[] {
  const keys = uniqueSorted([
    ...base.collections.map((def) => def.key),
    ...input.dev.collections.map((def) => def.key),
    ...input.production.collections.map((def) => def.key),
  ])
  const built: Built[] = []
  for (const key of keys) {
    const b = findByKey(base.collections, key)
    const d = findByKey(input.dev.collections, key)
    const p = findByKey(input.production.collections, key)
    if (deepEqual(b, d)) continue

    const kind: PlanItemKind = !b
      ? 'schema.add'
      : !d
        ? 'schema.remove'
        : 'schema.change'
    const productionChanged = !deepEqual(b, p)
    // Dev equal to production leaves nothing to resolve, so it is never a conflict.
    const conflict = productionChanged && !deepEqual(d, p)
    const dropped = droppedFields(
      p?.fields ?? [],
      d?.fields ?? [],
      input.productionFieldUsage[key] ?? {},
    )
    const attention: PlanAttention = conflict
      ? 'conflict'
      : dropped.length > 0
        ? 'drops-content'
        : null
    const def = (d ?? b) as SchemaSnapshotItem
    built.push({
      item: {
        id: `schema:${key}`,
        kind,
        label: schemaLabel(kind, def),
        collectionKey: key,
        summary: {
          changedFields: changedFieldKeys(b?.fields ?? [], d?.fields ?? []),
          ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
        },
        devChanged: true,
        productionChanged,
        attention,
      },
      fingerprint: { base: b ?? null, dev: d ?? null, prod: p ?? null },
    })
  }
  return built
}

function languageItem(input: PlanInput, base: SchemaSnapshot): Built | null {
  const baseLanguages = base.languages
  const devLanguages = input.dev.languages
  // A site cannot clear its languages, so a dev env with none has no change to push.
  if (devLanguages == null || deepEqual(baseLanguages, devLanguages)) {
    return null
  }
  const productionLanguages = input.production.languages
  const productionChanged = !deepEqual(baseLanguages, productionLanguages)
  // Only a switch of an existing main language stamps data; a first language has nothing to stamp.
  const mainChanged =
    baseLanguages != null && baseLanguages.main !== devLanguages.main
  const attention: PlanAttention =
    productionChanged && !deepEqual(devLanguages, productionLanguages)
      ? 'conflict'
      : mainChanged
        ? 'main-language'
        : null
  return {
    item: {
      id: 'languages',
      kind: 'languages',
      label: 'Site languages',
      collectionKey: null,
      summary: mainChanged ? { stampCount: input.stampCount } : {},
      devChanged: true,
      productionChanged,
      attention,
    },
    fingerprint: {
      base: baseLanguages,
      dev: devLanguages,
      prod: productionLanguages,
    },
  }
}

/** Whether a dev entry differs from its baseline (or has none). */
function entryChanged(dev: PlanEntry): boolean {
  const base = dev.originBaseline
  if (!base) return true
  return (
    dev.slug !== base.slug ||
    !deepEqual(dev.draftData, base.data) ||
    dev.publishedSlug !== base.publishedSlug ||
    !deepEqual(dev.publishedData, base.publishedData) ||
    dev.status !== base.status
  )
}

function entrySummary(dev: PlanEntry): PlanSummary {
  const base = dev.originBaseline
  if (!base) {
    return {
      changedFields: Object.keys(dev.draftData),
      draftChanged: true,
      readyChanged: dev.publishedData != null,
    }
  }
  const draftChanged =
    dev.slug !== base.slug || !deepEqual(dev.draftData, base.data)
  const readyChanged =
    dev.publishedSlug !== base.publishedSlug ||
    !deepEqual(dev.publishedData, base.publishedData) ||
    dev.status !== base.status
  const changedFields = uniqueSorted([
    ...changedDataKeys(base.data, dev.draftData),
    ...changedDataKeys(base.publishedData ?? {}, dev.publishedData ?? {}),
  ])
  return { changedFields, draftChanged, readyChanged }
}

function entryFingerprint(
  dev: PlanEntry,
  prod: PlanProductionEntry | undefined,
) {
  return {
    base: dev.originBaseline,
    dev: {
      slug: dev.slug,
      draftData: dev.draftData,
      publishedSlug: dev.publishedSlug,
      publishedData: dev.publishedData,
      status: dev.status,
    },
    prod: prod
      ? {
          contentVersion: prod.contentVersion,
          status: prod.status,
          scheduled: prod.scheduled,
        }
      : null,
  }
}

function entryItems(input: PlanInput, addedKeys: Set<string>): Built[] {
  const productionById = new Map(
    input.productionEntries.map((row) => [row.id, row]),
  )
  const built: Built[] = []
  const devEntries = [...input.devEntries].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  for (const dev of devEntries) {
    const archive = dev.status === 'archived'

    if (dev.originEntryId != null) {
      if (!entryChanged(dev)) continue
      const prod = productionById.get(dev.originEntryId)
      if (!prod && archive) continue
      const productionChanged =
        !prod || prod.contentVersion !== dev.originContentVersion
      const attention: PlanAttention = !prod
        ? 'deleted-in-production'
        : prod.scheduled
          ? 'scheduled'
          : productionChanged
            ? 'conflict'
            : null
      built.push(
        entryBuilt(dev, prod, {
          kind: archive ? 'entry.archive' : 'entry.change',
          attention,
          productionChanged,
        }),
      )
      continue
    }

    // Dev-created entries (no origin). Archived ones were never published.
    if (archive) continue
    if (dev.collectionKind === 'global') {
      // A section's single entry is created with its section: match it by key.
      const match = input.productionEntries.find(
        (row) =>
          row.collectionKey === dev.collectionKey &&
          row.collectionKind === 'global' &&
          row.slug === dev.slug,
      )
      if (!match && !addedKeys.has(dev.collectionKey)) continue
      built.push(
        entryBuilt(dev, match, {
          kind: 'entry.change',
          attention: null,
          productionChanged: false,
        }),
      )
      continue
    }
    const collectionExists =
      input.production.collections.some(
        (def) => def.key === dev.collectionKey,
      ) || addedKeys.has(dev.collectionKey)
    if (!collectionExists) continue
    built.push(
      entryBuilt(dev, undefined, {
        kind: 'entry.new',
        attention: null,
        productionChanged: false,
      }),
    )
  }
  return built
}

function entryBuilt(
  dev: PlanEntry,
  prod: PlanProductionEntry | undefined,
  options: {
    kind: PlanItemKind
    attention: PlanAttention
    productionChanged: boolean
  },
): Built {
  const item: PlanItem = {
    id: `entry:${dev.id}`,
    kind: options.kind,
    label: `"${dev.slug}" (${dev.collectionKey})`,
    collectionKey: dev.collectionKey,
    devId: dev.id,
    summary: entrySummary(dev),
    devChanged: true,
    productionChanged: options.productionChanged,
    attention: options.attention,
  }
  if (prod) {
    item.productionId = prod.id
    item.productionContentVersion = prod.contentVersion
  }
  return { item, fingerprint: entryFingerprint(dev, prod) }
}

/**
 * Everything changed in dev since the fork or the last push, with the
 * Needs-attention flags, and the hash a push must echo back. Items are in
 * schema, languages, entries order; each group sorted by id.
 */
export function buildPlan(input: PlanInput): Plan {
  const base = input.base ?? EMPTY_SCHEMA
  const schema = schemaItems(input, base)
  const addedKeys = new Set(
    schema
      .filter((entry) => entry.item.kind === 'schema.add')
      .map((entry) => entry.item.collectionKey ?? ''),
  )
  const languages = languageItem(input, base)
  const entries = entryItems(input, addedKeys)
  const built = [...schema, ...(languages ? [languages] : []), ...entries]
  const items = built.map((entry) => entry.item)
  const fingerprints = built
    .map(({ item, fingerprint }) => ({
      id: item.id,
      kind: item.kind,
      productionContentVersion: item.productionContentVersion ?? null,
      attention: item.attention,
      summary: item.summary,
      fingerprint,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { items, planHash: sha256(stableStringify(fingerprints)) }
}

/**
 * Items a push applies. Undecided Needs-attention items are skipped, and
 * `scheduled` never applies (the production schedule must be resolved first).
 */
export function selectPlanItems(
  items: PlanItem[],
  decisions: { exclude: string[]; apply: string[] },
): { selected: PlanItem[]; skipped: PlanItem[] } {
  const excluded = new Set(decisions.exclude)
  const applied = new Set(decisions.apply)
  const selected: PlanItem[] = []
  const skipped: PlanItem[] = []
  for (const item of items) {
    const take =
      !excluded.has(item.id) &&
      (item.attention === null ||
        (item.attention !== 'scheduled' && applied.has(item.id)))
    ;(take ? selected : skipped).push(item)
  }
  return { selected, skipped }
}

/**
 * Production changes since the baseline, whatever the dev env holds: schema
 * keys and languages that differ from the baseline, and forked entries whose
 * production `content_version` moved or whose row is gone. Drives the
 * "Production changed since the last sync" notice.
 */
export function productionChangeCount(input: PlanInput): number {
  const base = input.base ?? EMPTY_SCHEMA
  const keys = uniqueSorted([
    ...base.collections.map((def) => def.key),
    ...input.production.collections.map((def) => def.key),
  ])
  let count = 0
  for (const key of keys) {
    if (
      !deepEqual(
        findByKey(base.collections, key),
        findByKey(input.production.collections, key),
      )
    ) {
      count += 1
    }
  }
  if (!deepEqual(base.languages, input.production.languages)) count += 1
  const productionById = new Map(
    input.productionEntries.map((row) => [row.id, row]),
  )
  for (const dev of input.devEntries) {
    if (dev.originEntryId == null) continue
    const prod = productionById.get(dev.originEntryId)
    if (!prod || prod.contentVersion !== dev.originContentVersion) count += 1
  }
  return count
}
