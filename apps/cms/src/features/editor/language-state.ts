/**
 * Pure helpers for the multilingual entry and section editors. No React, so
 * they are unit tested and shared by the language bar, the details panel and
 * the top bar. Storage and the hook live in `use-content-language.ts`.
 *
 * Single-language sites never reach these helpers: `editorLanguages` returns
 * null for them, and the editor then behaves exactly as before.
 */
import { isTranslatable, localeStatus } from '#/lib/content-locale'
import type { LocaleCtx, LocaleStatus } from '#/lib/content-locale'
import type { EntryData, Field, SiteLanguages } from '#/lib/types'

/** The site's languages when there is more than one; null otherwise. */
export function editorLanguages(
  languages: SiteLanguages | null | undefined,
): SiteLanguages | null {
  if (!languages) return null
  const all = languages.all.includes(languages.main)
    ? languages.all
    : [languages.main, ...languages.all]
  const unique = [...new Set(all)]
  return unique.length > 1 ? { main: languages.main, all: unique } : null
}

export function localeContext(
  languages: SiteLanguages,
  fields: Field[],
): LocaleCtx {
  return { main: languages.main, all: languages.all, fields }
}

/**
 * Required languages for ready and schedule: the main language, plus the
 * collection's `requiredLanguages` that exist on the site. Site order.
 */
export function requiredLocales(
  languages: SiteLanguages,
  requiredLanguages: readonly string[],
): string[] {
  return languages.all.filter(
    (code) =>
      code === languages.main ||
      requiredLanguages.some((item) => item === code),
  )
}

/** Required translatable fields, the denominator of a completion ring. */
export function requiredTranslatableFields(fields: Field[]): Field[] {
  return fields.filter((field) => field.required && isTranslatable(field))
}

export type RingState = 'complete' | 'partial' | 'empty'

/**
 * Fraction of the completion ring: filled required translatable fields over
 * the total. With no required translatable fields it is 1 once the language
 * is started, otherwise 0.
 */
export function ringFraction(status: LocaleStatus, total: number): number {
  if (total === 0) return status.started ? 1 : 0
  const filled = total - status.missing.length
  return Math.max(0, Math.min(1, filled / total))
}

export function ringState(status: LocaleStatus): RingState {
  if (!status.started) return 'empty'
  return status.complete ? 'complete' : 'partial'
}

export type LocaleSummary = {
  locale: string
  required: boolean
  status: LocaleStatus
  state: RingState
  fraction: number
  /** Required and not complete: drawn in the warning tone. */
  warning: boolean
  /** Keys of the missing required translatable fields. */
  missing: string[]
}

/** One summary per language in site order. Memoise on `data` and `ctx`. */
export function localeSummaries(
  data: EntryData,
  ctx: LocaleCtx,
  required: readonly string[],
): LocaleSummary[] {
  const total = requiredTranslatableFields(ctx.fields).length
  return ctx.all.map((locale) => {
    const status = localeStatus(data, locale, ctx)
    const isRequired = required.includes(locale)
    return {
      locale,
      required: isRequired,
      status,
      state: ringState(status),
      fraction: ringFraction(status, total),
      warning: isRequired && !status.complete,
      missing: status.missing,
    }
  })
}

export type LocaleBlocker = { locale: string; missing: string[] }

/** Required languages that are not complete, in site order. */
export function blockersFor(
  data: EntryData,
  ctx: LocaleCtx,
  required: readonly string[],
): LocaleBlocker[] {
  return ctx.all
    .filter((locale) => required.includes(locale))
    .map((locale) => ({
      locale,
      missing: localeStatus(data, locale, ctx).missing,
    }))
    .filter((blocker) => blocker.missing.length > 0)
}

/** Labels of the given field keys, in field order, falling back to the key. */
export function fieldLabels(
  keys: readonly string[],
  fields: Field[],
): string[] {
  return keys.map(
    (key) => fields.find((field) => field.key === key)?.label ?? key,
  )
}

/** Compact label for narrow screens: "NL", "EN-BE". */
export function languageCode(code: string): string {
  return code.toUpperCase()
}

export type LanguageStateKey =
  'complete' | 'missing' | 'not_started' | 'optional'

/**
 * Which status line a language gets in the details panel: "Complete",
 * "2 missing", "Not started" (required, empty) or "Optional" (not required
 * and empty).
 */
export function languageStateKey(summary: LocaleSummary): LanguageStateKey {
  if (summary.status.complete && summary.status.started) return 'complete'
  if (!summary.status.started) {
    return summary.required ? 'not_started' : 'optional'
  }
  return 'missing'
}
