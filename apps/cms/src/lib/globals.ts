import {
  isReservedCollectionKey,
  isSafeIdentifier,
} from './content-identifiers'
import type { Field, SnapshotEntry, SnapshotGlobal } from './types'

/** The one entry every site content section owns. Never shown or addressed by slug. */
export const GLOBAL_ENTRY_SLUG = '$global'
export const GLOBAL_GROUP_MAX_LENGTH = 80
export const GLOBAL_PREVIEW_PATH_MAX_LENGTH = 512

/**
 * Sections and collections share one key space, so they share the reserved
 * names too (`globals` is the generated accessor for sections).
 */
export function isReservedGlobalKey(key: string): boolean {
  return isReservedCollectionKey(key)
}

export function isValidGlobalKey(key: string): boolean {
  return isSafeIdentifier(key) && !isReservedGlobalKey(key)
}

/**
 * A path on the site only: starts with a single `/` (so `//host` cannot move
 * a preview link to another origin), no query, fragment, backslash or
 * whitespace, bounded length.
 */
export function isValidPreviewPath(path: string): boolean {
  return (
    path.length <= GLOBAL_PREVIEW_PATH_MAX_LENGTH &&
    /^\/(?!\/)[^\s?#\\]*$/.test(path)
  )
}

/** Field rules that only apply to site content sections. Paths are field keys. */
export function validateGlobalFields(
  fields: Field[],
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = []
  for (const field of fields) {
    if (field.type === 'slug') {
      issues.push({
        path: field.key,
        message: 'Site content cannot use a slug field.',
      })
    }
    if (field.group !== undefined) {
      if (field.group.trim() === '') {
        issues.push({
          path: field.key,
          message: 'A group heading cannot be empty.',
        })
      } else if (field.group.length > GLOBAL_GROUP_MAX_LENGTH) {
        issues.push({
          path: field.key,
          message: `A group heading can be at most ${GLOBAL_GROUP_MAX_LENGTH} characters.`,
        })
      }
    }
  }
  return issues
}

/** Public URL a section's SEO canonical points at, if the section has a preview path. */
export function globalPublicUrl(
  productionUrl: string,
  previewPath: string | null | undefined,
): string | null {
  if (!previewPath) return null
  try {
    return new URL(previewPath, new URL(productionUrl)).toString()
  } catch {
    return null
  }
}

/** A section's language views in the entry shape; a section has one slug. */
function sectionLocalesAsEntryLocales(
  locales: NonNullable<SnapshotGlobal['locales']>,
): NonNullable<SnapshotEntry['locales']> {
  return Object.fromEntries(
    Object.entries(locales).map(([locale, view]) => [
      locale,
      { slug: GLOBAL_ENTRY_SLUG, data: view.data, seo: view.seo },
    ]),
  )
}

/**
 * Sections as one-entry lists keyed by section key, the shape collections
 * already have. Release diffs and asset walks use it so sections are handled
 * like any other content. A section that was never marked ready is not
 * released content yet, so it is left out.
 */
export function globalsAsEntryLists(
  globals: Record<string, SnapshotGlobal> | undefined,
): Record<string, SnapshotEntry[]> {
  const lists: Record<string, SnapshotEntry[]> = {}
  for (const [key, global] of Object.entries(globals ?? {})) {
    if (global.publishedAt === null) continue
    lists[key] = [
      {
        id: global.id,
        slug: GLOBAL_ENTRY_SLUG,
        publishedAt: global.publishedAt,
        data: global.data,
        seo: global.seo,
        ...(global.locale === undefined ? {} : { locale: global.locale }),
        ...(global.locales === undefined
          ? {}
          : { locales: sectionLocalesAsEntryLocales(global.locales) }),
      },
    ]
  }
  return lists
}
