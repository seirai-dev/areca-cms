import { baseLocale, readLocale } from '#/lib/content-locale'
import { entryTitle } from '#/lib/content/utils'
import type {
  EntryData,
  Field,
  SectionSnapshots,
  SiteLanguages,
} from '#/lib/types'
import { richTextHeadings } from '#/server/richtext/entry-links'
import {
  diffSectionSnapshots,
  sectionKey,
} from '#/server/richtext/section-diff'
import type { SectionChange } from '#/server/richtext/section-diff'

import { mapRichTextValues } from './entry-links.ts'
import { localeCtxFor } from './locale-validation.ts'

/**
 * The headings of an entry's rich text, per language and field, and what a
 * save changed of them (docs/design/rich-text-links.md, decision 21). The
 * pure comparison is in `richtext/section-diff.ts`.
 */

/**
 * The title of an entry in one language: the translation's when the language is
 * not the main one, the main title otherwise. Lists of links show the title
 * in the language the link is in.
 */
export function titleIn(input: {
  data: EntryData
  fields: Field[]
  slug: string
  locale: string
  languages: SiteLanguages | null
}): string {
  const view =
    input.languages &&
    input.locale !== '' &&
    input.locale !== input.languages.main
      ? readLocale(
          input.data,
          input.locale,
          localeCtxFor(input.languages, input.fields),
        )
      : input.data
  return entryTitle(view, input.fields, input.slug)
}

/**
 * The headings of every rich text value of `data`, keyed the way the link
 * index keys its rows: the language of the text ('' on a single-language
 * site, the main language for the base slot of a multilingual one).
 */
export async function sectionSnapshotsOf(
  data: EntryData,
  fields: Field[],
  languages: SiteLanguages | null,
): Promise<SectionSnapshots> {
  const ctx = languages ? localeCtxFor(languages, fields) : null
  const base = ctx ? baseLocale(data, ctx) : ''
  const out: SectionSnapshots = {}
  await mapRichTextValues(data, fields, (json, slot) => {
    const locale = slot.locale ?? base
    out[sectionKey(locale, slot.field)] = richTextHeadings(json).map(
      (heading) => ({ id: heading.id, text: heading.text }),
    )
    return json
  })
  return out
}

/**
 * The headings a save changed that links may point at, from the headings
 * before it. `baseline` is the snapshot taken at the last explicit save, or
 * null for an entry that has none yet: then the previous draft is the
 * baseline.
 */
export async function sectionChangesOf(input: {
  previousData: EntryData
  baseline: SectionSnapshots | null
  nextData: EntryData
  fields: Field[]
  languages: SiteLanguages | null
}): Promise<{ changes: SectionChange[]; next: SectionSnapshots }> {
  const next = await sectionSnapshotsOf(
    input.nextData,
    input.fields,
    input.languages,
  )
  const before =
    input.baseline ??
    (await sectionSnapshotsOf(
      input.previousData,
      input.fields,
      input.languages,
    ))
  return { changes: diffSectionSnapshots(before, next), next }
}
