/**
 * Reference mapping for a push (docs/design/dev-environments.md, "Reference
 * mapping"). Pure: no database imports.
 *
 * A `reference` field stores the target entry id, in the base values and in
 * every `$i18n.<locale>` slot. Dev ids are mapped to production ids: a forked
 * entry maps to its origin, a dev-created entry to the id it got in this push.
 * Anything else is cleared and reported.
 */
import { I18N_KEY } from '#/lib/content-locale'
import type { EntryData, Field } from '#/lib/types'
import { remapEntryLinks } from '#/server/richtext/entry-links'

/**
 * A reference or an entry link that was cleared because its target cannot
 * exist in production. A cleared link keeps its text (it is plain text now).
 */
export type ReferenceWarning = {
  field: string
  /** The language slot, when the reference sat in one. */
  locale?: string
  /** The dev entry id the reference pointed at. */
  devTargetId: string
  /** `link`: a rich text entry link. Default `reference`. */
  kind?: 'reference' | 'link'
}

/** Dev entry id to production entry id, or undefined when there is none. */
export type ReferenceLookup = (devId: string) => string | undefined

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Production ids that dev ids of this push resolve to: the origin of each
 * forked entry whose production row still exists, plus the ids of entries
 * created by this push.
 */
export function referenceTargets(
  devEntries: { id: string; originEntryId: string | null }[],
  productionIds: Set<string>,
  created: Map<string, string>,
): Map<string, string> {
  const targets = new Map<string, string>()
  for (const dev of devEntries) {
    if (dev.originEntryId && productionIds.has(dev.originEntryId)) {
      targets.set(dev.id, dev.originEntryId)
    }
  }
  for (const [devId, productionId] of created) {
    targets.set(devId, productionId)
  }
  return targets
}

/**
 * The lookup a push maps references with: a dev id maps through `targets`; a
 * production id that was never copied to dev (so it has no dev twin) maps to
 * itself, and is kept as it is. Anything else is unmappable.
 */
export function referenceLookup(
  targets: Map<string, string>,
  productionIds: Set<string>,
): ReferenceLookup {
  return (id) => targets.get(id) ?? (productionIds.has(id) ? id : undefined)
}

function remapScope(
  scope: Record<string, unknown>,
  keys: string[],
  lookup: ReferenceLookup,
  locale: string | undefined,
  cleared: ReferenceWarning[],
) {
  for (const key of keys) {
    const value = scope[key]
    if (typeof value !== 'string' || value === '') continue
    const target = lookup(value)
    if (target !== undefined) {
      scope[key] = target
      continue
    }
    delete scope[key]
    cleared.push({
      field: key,
      ...(locale !== undefined ? { locale } : {}),
      devTargetId: value,
    })
  }
}

/** Rich text entry links in one slot: re-pointed, or cleared to plain text. */
function remapRichTextScope(
  scope: Record<string, unknown>,
  keys: string[],
  lookup: ReferenceLookup,
  locale: string | undefined,
  cleared: ReferenceWarning[],
) {
  for (const key of keys) {
    const value = scope[key]
    if (!isPlainObject(value)) continue
    const mapped = remapEntryLinks(value, lookup)
    scope[key] = mapped.json
    for (const devTargetId of mapped.cleared) {
      cleared.push({
        field: key,
        ...(locale !== undefined ? { locale } : {}),
        devTargetId,
        kind: 'link',
      })
    }
  }
}

/**
 * Entry data with every reference and entry link re-pointed through `lookup`.
 * Returns a new object; `data` is not mutated. Reference fields and rich text
 * fields are touched, in the base and in every language slot.
 */
export function remapReferences(
  data: EntryData,
  fields: Field[],
  lookup: ReferenceLookup,
): { data: EntryData; cleared: ReferenceWarning[] } {
  const keys = fields
    .filter((field) => field.type === 'reference')
    .map((field) => field.key)
  const richKeys = fields
    .filter((field) => field.type === 'richtext')
    .map((field) => field.key)
  const cleared: ReferenceWarning[] = []
  if (keys.length === 0 && richKeys.length === 0) return { data, cleared }

  const next: EntryData = { ...data }
  remapScope(next, keys, lookup, undefined, cleared)
  remapRichTextScope(next, richKeys, lookup, undefined, cleared)

  const translations = data[I18N_KEY]
  if (isPlainObject(translations)) {
    const nextTranslations: Record<string, unknown> = {}
    for (const [locale, slot] of Object.entries(translations)) {
      if (!isPlainObject(slot)) {
        nextTranslations[locale] = slot
        continue
      }
      const copy: Record<string, unknown> = { ...slot }
      remapScope(copy, keys, lookup, locale, cleared)
      remapRichTextScope(copy, richKeys, lookup, locale, cleared)
      nextTranslations[locale] = copy
    }
    next[I18N_KEY] = nextTranslations
  }
  return { data: next, cleared }
}
