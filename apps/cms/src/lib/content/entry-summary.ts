import type { EntryStatus, EntryData, Field, SiteLanguages } from '#/lib/types'
import { isMultilingual } from '#/lib/site-languages'

import { isEditedSinceReady } from './edited-since-ready'
import { entryCoverage } from './entry-coverage'
import type { LocaleCoverage } from './entry-coverage'
import { entryTitle, firstImageAssetId } from './utils'

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
    title: entryTitle(row.draftData, fields, row.slug),
    cover: firstImageAssetId(row.draftData, fields),
    editedSinceReady: isEditedSinceReady({
      status: row.status,
      draftData: row.draftData,
      publishedData: row.publishedData,
    }),
    coverage: isMultilingual(languages)
      ? entryCoverage(row.draftData, fields, languages, input.requiredLanguages)
      : null,
  }
}
