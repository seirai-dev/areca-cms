/**
 * Field-level helpers over entry data: which field keys hold content, and
 * copying a set of field values from one version of an entry to another.
 * Pure, so the push plan (server/dev-env/plan.ts) and the push itself share
 * one definition. The SQL in server/content/field-data.ts counts the same keys.
 */
import { I18N_KEY } from '#/lib/content-locale'
import type { EntryData } from '#/lib/types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A value that is not content: null, empty text, an empty list or object. */
export function isBlankFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return /^ *$/.test(value)
  if (Array.isArray(value)) return value.length === 0
  if (isPlainObject(value)) return Object.keys(value).length === 0
  return false
}

/** Field keys in one stored version that hold content, base and every language slot. */
export function fieldContentKeys(
  data: EntryData | null | undefined,
): Set<string> {
  const keys = new Set<string>()
  if (!data) return keys
  const collect = (source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('$') || isBlankFieldValue(value)) continue
      keys.add(key)
    }
  }
  collect(data)
  const translations = data[I18N_KEY]
  if (isPlainObject(translations)) {
    for (const slot of Object.values(translations)) {
      if (isPlainObject(slot)) collect(slot)
    }
  }
  return keys
}

/**
 * Field keys present in one stored version, base and every language slot, blank
 * values included. A removal that is not applied keeps exactly what production
 * stores, so presence (not content) decides what is kept.
 */
export function presentFieldKeys(
  data: EntryData | null | undefined,
): Set<string> {
  const keys = new Set<string>()
  if (!data) return keys
  const collect = (source: Record<string, unknown>) => {
    for (const key of Object.keys(source)) {
      if (!key.startsWith('$')) keys.add(key)
    }
  }
  collect(data)
  const translations = data[I18N_KEY]
  if (isPlainObject(translations)) {
    for (const slot of Object.values(translations)) {
      if (isPlainObject(slot)) collect(slot)
    }
  }
  return keys
}

/**
 * Whether a stored version holds any value (blank or not) under one of the
 * keys, base or language slot. Matches what the purge of a removed field deletes.
 */
export function holdsAnyFieldKey(
  data: EntryData | null | undefined,
  keys: string[],
): boolean {
  if (!data) return false
  if (keys.some((key) => Object.hasOwn(data, key))) return true
  const translations = data[I18N_KEY]
  return (
    isPlainObject(translations) &&
    Object.values(translations).some(
      (slot) =>
        isPlainObject(slot) && keys.some((key) => Object.hasOwn(slot, key)),
    )
  )
}

/** Removes the keys from the base and from every language slot. */
export function withoutFieldKeys(data: EntryData, keys: string[]): EntryData {
  if (keys.length === 0) return data
  const next: EntryData = { ...data }
  for (const key of keys) delete next[key]
  const translations = next[I18N_KEY]
  if (isPlainObject(translations)) {
    next[I18N_KEY] = Object.fromEntries(
      Object.entries(translations).map(([locale, slot]) => [
        locale,
        isPlainObject(slot)
          ? Object.fromEntries(
              Object.entries(slot).filter(([key]) => !keys.includes(key)),
            )
          : slot,
      ]),
    )
  }
  return next
}

/**
 * A copy of `target` where each listed field takes its value from `source`
 * (base and language slots). A field that `source` does not hold is removed
 * from `target`, so the result matches `source` for these keys and leaves the
 * other fields as they are.
 */
export function carryFieldValues(
  target: EntryData,
  source: EntryData | null | undefined,
  keys: string[],
): EntryData {
  if (keys.length === 0) return target
  const next: EntryData = { ...target }
  for (const key of keys) {
    if (source && Object.hasOwn(source, key)) next[key] = source[key]
    else delete next[key]
  }

  const targetTranslations = isPlainObject(target[I18N_KEY])
    ? target[I18N_KEY]
    : {}
  const sourceTranslations =
    source && isPlainObject(source[I18N_KEY]) ? source[I18N_KEY] : {}
  const locales = new Set([
    ...Object.keys(targetTranslations),
    ...Object.keys(sourceTranslations),
  ])
  if (locales.size === 0) return next

  const translations: Record<string, unknown> = {}
  for (const locale of locales) {
    const current = targetTranslations[locale]
    const from = sourceTranslations[locale]
    const fromSlot = isPlainObject(from) ? from : {}
    if (!isPlainObject(current)) {
      // No object slot in the target: a slot is made only for values to carry,
      // and a non-object slot is kept as it is.
      const carried = keys.filter((key) => Object.hasOwn(fromSlot, key))
      if (carried.length > 0) {
        translations[locale] = Object.fromEntries(
          carried.map((key) => [key, fromSlot[key]]),
        )
      } else if (current !== undefined) {
        translations[locale] = current
      }
      continue
    }
    const slot: Record<string, unknown> = { ...current }
    for (const key of keys) {
      if (Object.hasOwn(fromSlot, key)) slot[key] = fromSlot[key]
      else delete slot[key]
    }
    if (Object.keys(slot).length > 0) translations[locale] = slot
  }
  if (Object.keys(translations).length > 0) {
    next[I18N_KEY] = translations
  } else {
    delete next[I18N_KEY]
  }
  return next
}
