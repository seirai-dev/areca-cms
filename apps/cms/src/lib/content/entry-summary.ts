import type { EntryStatus, EntryData, Field, SiteLanguages } from '#/lib/types'
import { isMultilingual } from '#/lib/site-languages'

import { isEditedSinceReady } from './edited-since-ready'
import { entryCoverage } from './entry-coverage'
import type { LocaleCoverage } from './entry-coverage'
import { firstTextField } from './utils'

/**
 * One row of a collection list: what the list, the overview, the reference
 * picker and the command palette show. It carries no draft or published
 * content; the title, cover, coverage and "edited since ready" flag are
 * computed on the server from that content.
 */
export type EntrySummary = {
  id: string
  collectionKey: string
  slug: string
  status: EntryStatus
  publishedSlug: string | null
  createdAt: string | Date
  updatedAt: string | Date
  scheduledAt: string | Date | null
  publishedAt: string | Date | null
  updatedBy: string | null
  updatedByName: string | null
  title: string
  /** Asset id of the first image field, when the draft sets one. */
  cover: string | null
  editedSinceReady: boolean
  /** One chip per site language; null on a single-language site. */
  coverage: LocaleCoverage[] | null
}

/** The columns a summary is built from. */
export type EntrySummarySource = {
  id: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  publishedData: EntryData | null
  publishedSlug: string | null
  createdAt: string | Date
  updatedAt: string | Date
  scheduledAt: string | Date | null
  publishedAt: string | Date | null
  updatedBy: string | null
  updatedByName: string | null
}

/**
 * What a summary is built from when the server has already extracted the
 * small values in SQL (`listEntrySummaries`): the raw value of the first text
 * field and of the first image field, and the edited flag. The draft is only
 * read on a multilingual site, for the coverage chips.
 */
export type EntrySummaryParts = Omit<
  EntrySummarySource,
  'draftData' | 'publishedData'
> & {
  /** The first text field's value when it is a string, else null. */
  titleValue: string | null
  /** The first image field's value when it is a string, else null. */
  coverValue: string | null
  editedSinceReady: boolean
  draftData: EntryData | null
}

/**
 * Builds one list summary. Pure: the server calls it on each row it reads,
 * and the tests check the output against the shared helpers directly.
 */
export function toEntrySummary(input: {
  collectionKey: string
  fields: Field[]
  languages: SiteLanguages | null | undefined
  requiredLanguages: string[]
  row: EntrySummarySource
}): EntrySummary {
  const { row, fields } = input
  const textField = firstTextField(fields)
  const imageField = fields.find((field) => field.type === 'image')
  const titleValue = textField ? row.draftData[textField.key] : null
  const coverValue = imageField ? row.draftData[imageField.key] : null
  return summaryFromParts({
    ...input,
    row: {
      ...row,
      titleValue: typeof titleValue === 'string' ? titleValue : null,
      coverValue: typeof coverValue === 'string' ? coverValue : null,
      editedSinceReady: isEditedSinceReady({
        status: row.status,
        draftData: row.draftData,
        publishedData: row.publishedData,
      }),
    },
  })
}

/** Same result as `toEntrySummary`, from values extracted in SQL. */
export function summaryFromParts(input: {
  collectionKey: string
  fields: Field[]
  languages: SiteLanguages | null | undefined
  requiredLanguages: string[]
  row: EntrySummaryParts
}): EntrySummary {
  const { row, fields } = input
  const languages = input.languages ?? null
  return {
    id: row.id,
    collectionKey: input.collectionKey,
    slug: row.slug,
    status: row.status,
    publishedSlug: row.publishedSlug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scheduledAt: row.scheduledAt,
    publishedAt: row.publishedAt,
    updatedBy: row.updatedBy,
    updatedByName: row.updatedByName,
    // Same rules as `entryTitle` and `firstImageAssetId`.
    title: row.titleValue?.trim() ? row.titleValue : row.slug,
    cover: row.coverValue ? row.coverValue : null,
    editedSinceReady: row.editedSinceReady,
    coverage: isMultilingual(languages)
      ? entryCoverage(
          row.draftData ?? {},
          fields,
          languages,
          input.requiredLanguages,
        )
      : null,
  }
}
