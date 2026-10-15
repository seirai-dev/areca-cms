/**
 * Content languages: reading and writing one language of an entry.
 *
 * Pure and shared by server and client, so it must not import server code.
 * Every read or write of `$i18n` / `$locale` goes through this module.
 * See docs/design/content-languages.md.
 */
import { isEmptyRichText } from './rich-text-empty.ts'
import { SEO_KEY } from './seo.ts'
import type { EntryData, Field, FieldType } from './types.ts'

/** Holds the translations of an entry, keyed by locale. */
export const I18N_KEY = '$i18n'
/** Language of the base values. Absent means the site's current main language. */
export const LOCALE_KEY = '$locale'
/** Per-language entry slug. Unset means the main slug is used. */
export const SLUG_KEY = '$slug'

/** Field type defaults. A field's own `translatable` switch overrides these. */
export const TRANSLATABLE_BY_DEFAULT: Record<FieldType, boolean> = {
  text: true,
  textarea: true,
  richtext: true,
  url: true,
  image: false,
  date: false,
  datetime: false,
  select: false,
  reference: false,
  // Per-language slugs live in `$slug`, not in the slug field.
  slug: false,
  boolean: false,
  number: false,
}

/** Whether a field's value is stored per language. Use this, not the raw switch. */
export function isTranslatable(field: Field): boolean {
  return field.translatable ?? TRANSLATABLE_BY_DEFAULT[field.type]
}

/** Site language settings plus the fields of the collection or section. */
export type LocaleCtx = { main: string; all: string[]; fields: Field[] }

export type LocaleStatus = {
  /** Some translatable value, `$seo` or `$slug` is filled in. */
  started: boolean
  /** Every required translatable field is filled in. */
  complete: boolean
  /** Keys of required translatable fields that are empty. */
  missing: string[]
}

export type ResolvedLocale = { locale: string; isFallback: boolean }

/** Keys stored per language besides the translatable fields. */
const LOCALIZED_META = [SEO_KEY, SLUG_KEY] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function has(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function translatableKeys(ctx: LocaleCtx): string[] {
  return ctx.fields.filter(isTranslatable).map((field) => field.key)
}

function sharedKeys(ctx: LocaleCtx): string[] {
  return ctx.fields
    .filter((field) => !isTranslatable(field))
    .map((field) => field.key)
}

function localizedKeys(ctx: LocaleCtx): string[] {
  return [...translatableKeys(ctx), ...LOCALIZED_META]
}

function translationsOf(data: EntryData): Record<string, EntryData> {
  const value = data[I18N_KEY]
  return isPlainObject(value) ? (value as Record<string, EntryData>) : {}
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (isPlainObject(value)) return Object.values(value).every(isEmptyValue)
  return false
}

function isEmptyField(field: Field, value: unknown): boolean {
  if (field.type === 'richtext') {
    return isEmptyValue(value) || isEmptyRichText(value)
  }
  return isEmptyValue(value)
}

/** Language of the base values: `$locale`, or the main language when unset. */
export function baseLocale(data: EntryData, ctx: LocaleCtx): string {
  const value = data[LOCALE_KEY]
  return typeof value === 'string' && value !== '' ? value : ctx.main
}

/**
 * Flat view of one language: every shared field from the base, plus the
 * translatable fields, `$seo` and `$slug` of that language. Keys the language
 * does not have are absent. Never includes `$i18n` or `$locale`.
 */
export function readLocale(
  data: EntryData,
  locale: string,
  ctx: LocaleCtx,
): EntryData {
  const out: EntryData = {}
  for (const key of sharedKeys(ctx)) {
    if (has(data, key)) out[key] = data[key]
  }
  const translations = translationsOf(data)[locale]
  const source =
    locale === baseLocale(data, ctx)
      ? data
      : isPlainObject(translations)
        ? translations
        : {}
  for (const key of localizedKeys(ctx)) {
    if (has(source, key)) out[key] = source[key]
  }
  return out
}

/**
 * Inverse of `readLocale`. Returns a new object; `data` is not mutated.
 *
 * - Shared fields in `values` are written to the base. Shared keys absent
 *   from `values` are left unchanged.
 * - Translatable fields, `$seo` and `$slug` go to the base when `locale` is
 *   the base language, otherwise to `$i18n[locale]`. They are replaced as a
 *   set: a key absent from `values` (or `undefined`) is cleared in that
 *   language. `values` is the complete view of the language.
 * - `$i18n[locale]` is dropped when it becomes empty, and so is `$i18n`
 *   when no language is left.
 */
export function writeLocale(
  data: EntryData,
  locale: string,
  values: EntryData,
  ctx: LocaleCtx,
): EntryData {
  const next: EntryData = { ...data }
  const put = (target: EntryData, key: string) => {
    const value = has(values, key) ? values[key] : undefined
    if (value === undefined) delete target[key]
    else target[key] = value
  }

  for (const key of sharedKeys(ctx)) {
    if (has(values, key)) put(next, key)
  }

  if (locale === baseLocale(data, ctx)) {
    for (const key of localizedKeys(ctx)) put(next, key)
    return next
  }

  const translations = { ...translationsOf(data) }
  const slot: EntryData = {
    ...(isPlainObject(translations[locale]) ? translations[locale] : {}),
  }
  for (const key of localizedKeys(ctx)) put(slot, key)

  if (Object.keys(slot).length > 0) translations[locale] = slot
  else delete translations[locale]

  if (Object.keys(translations).length > 0) next[I18N_KEY] = translations
  else delete next[I18N_KEY]
  return next
}

/**
 * Completeness of one language. `missing` lists required translatable fields
 * that are empty in that language. For the base language `started` also
 * counts shared fields.
 */
export function localeStatus(
  data: EntryData,
  locale: string,
  ctx: LocaleCtx,
): LocaleStatus {
  const view = readLocale(data, locale, ctx)
  const missing = ctx.fields
    .filter(
      (field) =>
        field.required &&
        isTranslatable(field) &&
        isEmptyField(field, view[field.key]),
    )
    .map((field) => field.key)

  const isBase = locale === baseLocale(data, ctx)
  const started =
    ctx.fields
      .filter((field) => isBase || isTranslatable(field))
      .some((field) => !isEmptyField(field, view[field.key])) ||
    LOCALIZED_META.some((key) => !isEmptyValue(view[key]))

  return { started, complete: missing.length === 0, missing }
}

/**
 * Makes the base hold the main language. Data without `$locale` is already
 * in main, so it is returned as is. Otherwise the old base's localized values
 * move into `$i18n[oldBase]`, the main language's values move into the base,
 * and `$i18n[main]` and `$locale` are removed. Shared values stay in the base.
 * Nothing is lost, and every language reads the same afterwards.
 */
export function normalizeBase(data: EntryData, ctx: LocaleCtx): EntryData {
  const oldBase = baseLocale(data, ctx)
  if (oldBase === ctx.main) return data

  const localized = localizedKeys(ctx)
  const translations = { ...translationsOf(data) }
  const mainSlot = isPlainObject(translations[ctx.main])
    ? translations[ctx.main]
    : {}
  delete translations[ctx.main]

  const oldBaseSlot: EntryData = {}
  for (const key of localized) {
    if (has(data, key)) oldBaseSlot[key] = data[key]
  }

  const next: EntryData = {}
  for (const key of Object.keys(data)) {
    if (key === I18N_KEY || key === LOCALE_KEY || localized.includes(key)) {
      continue
    }
    next[key] = data[key]
  }
  for (const key of localized) {
    if (has(mainSlot, key)) next[key] = mainSlot[key]
  }

  if (Object.keys(oldBaseSlot).length > 0) translations[oldBase] = oldBaseSlot
  else delete translations[oldBase]

  if (Object.keys(translations).length > 0) next[I18N_KEY] = translations
  return next
}

/** Complete languages, in `ctx.all` order. Used for the snapshot. */
export function servedLocales(data: EntryData, ctx: LocaleCtx): string[] {
  return ctx.all.filter((locale) => localeStatus(data, locale, ctx).complete)
}

/**
 * Picks the language to serve, from the languages in `available` that are in
 * the site's list. Order: exact tag (case-insensitive), then the language
 * subtag (`nl-BE` to `nl`), then main, then the first available language in
 * site order. A missing request counts as main. Returns null when nothing is
 * available.
 */
export function resolveChain(
  requested: string | null | undefined,
  available: string[],
  ctx: LocaleCtx,
): ResolvedLocale | null {
  const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const usable = ctx.all.filter((locale) =>
    available.some((candidate) => sameTag(candidate, locale)),
  )
  const find = (tag: string) => usable.find((locale) => sameTag(locale, tag))

  const want = requested ? requested : ctx.main
  const exact = find(want)
  if (exact) return { locale: exact, isFallback: false }

  const subtag = want.split('-')[0] ?? want
  const subtagHit = subtag !== want ? find(subtag) : undefined
  if (subtagHit) return { locale: subtagHit, isFallback: true }

  const mainHit = find(ctx.main)
  if (mainHit) return { locale: mainHit, isFallback: true }

  const first = usable[0]
  return first ? { locale: first, isFallback: true } : null
}
