import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { asset } from '#/db/schema'

/**
 * "Missing description" for the Library filter, as one SQL predicate per
 * content language. It mirrors `isAltMissing` in `#/lib/asset-alt`:
 * - the main language (or no language) reads `alt_text`;
 * - every other language reads `alt_i18n[locale]` only, never `alt_text`,
 *   so a value that exists only through fallback counts as missing;
 * - blank (whitespace-only) and null count as missing; images only.
 */
export function missingAltFilter(
  locale: string | null,
  mainLocale: string | null,
): SQL {
  const value =
    locale === null || locale === mainLocale
      ? sql`${asset.altText}`
      : sql`(${asset.altI18n} ->> ${locale})`
  return sql`(${asset.mimeType} like 'image/%' and coalesce(${value} ~ '^\\s*$', true))`
}
