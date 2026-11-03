/**
 * Language coverage of one entry, for the list chips (one per site language).
 * The server computes it for each list summary (`listEntrySummaries`), from
 * the draft it reads, with `localeStatus`. See docs/design/content-languages.md.
 */
import { localeStatus } from '#/lib/content-locale'
import type { EntryData, Field, SiteLanguages } from '#/lib/types'

export type CoverageState = 'complete' | 'partial' | 'empty'

export type LocaleCoverage = {
  locale: string
  isMain: boolean
  /** Main, or listed in the collection's required languages. */
  required: boolean
  state: CoverageState
  /** Required translatable fields still empty in this language. */
  missing: number
}

/**
 * One entry per site language, in site order. `started` with an incomplete
 * language is partial; nothing filled in is empty.
 */
export function entryCoverage(
  draftData: EntryData,
  fields: Field[],
  languages: SiteLanguages,
  requiredLanguages: string[],
): LocaleCoverage[] {
  const ctx = { main: languages.main, all: languages.all, fields }
  return languages.all.map((locale) => {
    const isMain = locale === languages.main
    const status = localeStatus(draftData, locale, ctx)
    const state: CoverageState = status.complete
      ? 'complete'
      : status.started
        ? 'partial'
        : 'empty'
    return {
      locale,
      isMain,
      required: isMain || requiredLanguages.includes(locale),
      state,
      missing: status.missing.length,
    }
  })
}
