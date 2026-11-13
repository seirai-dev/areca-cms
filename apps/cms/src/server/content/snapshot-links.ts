import { readLocale } from '#/lib/content-locale'
import type { EntryData, Field, SiteLanguages } from '#/lib/types'
import { richTextHeadingIds } from '#/server/richtext/entry-links'
import type {
  EntryLinkResolution,
  EntryLinkTarget,
} from '#/server/richtext/entry-links'
import { entryTitle } from '#/lib/content/utils'

import { localeCtxFor } from './locale-validation.ts'
import { entryLinkPath, placeLinkTarget } from './entry-links.ts'
import type { LinkTargetRow } from './entry-links.ts'
import type { LinkResolver, LinkSource } from './snapshot-expand.ts'

/**
 * A link that will not work on the live site, or points at a section that is
 * gone. It never blocks a release: the link is published as plain text
 * (`not-live`, `missing`) or to the page (`missing-section`).
 */
export type LinkWarning = {
  sourceEntryId: string
  sourceTitle: string
  /** The source's collection key, or the section key for a site content section. */
  sourceCollectionKey: string
  /** True when the source is a site content section (it has no collection page). */
  sourceGlobal: boolean
  /** Language of the text. Null on a single-language site. */
  locale: string | null
  field: string
  targetEntryId: string
  targetTitle: string
  anchor: string | null
  reason: 'not-live' | 'missing' | 'missing-section'
}

/** An entry or section of the release, as a link target. */
export type SnapshotLinkTarget = {
  data: EntryData
  fields: Field[]
  slug: string
  /** Empty for a site content section. */
  routePattern: string
  localizedRoutes?: Record<string, string> | null
}

/**
 * Entry links of a release: each resolves to a live entry's path in the
 * language of the text, or is reported as a `LinkWarning`. `linkTargets` has
 * the rows of targets outside the release, to tell a draft from an entry that
 * does not exist.
 */
export function createSnapshotLinks(
  includedById: Map<string, SnapshotLinkTarget>,
  linkTargets: Map<string, LinkTargetRow>,
  languages: SiteLanguages | null,
): {
  linksFor: (source: LinkSource) => LinkResolver
  warnings: () => LinkWarning[]
} {
  const warnings = new Map<string, LinkWarning>()
  const headingCache = new Map<string, Set<string>>()

  function headingIdsOf(
    id: string,
    item: SnapshotLinkTarget,
    language: string | null,
  ): Set<string> {
    const key = `${id}|${language ?? ''}`
    const cached = headingCache.get(key)
    if (cached) return cached
    const shown =
      languages && language && language !== languages.main
        ? readLocale(item.data, language, localeCtxFor(languages, item.fields))
        : item.data
    const ids = new Set<string>()
    for (const field of item.fields) {
      if (field.type !== 'richtext') continue
      for (const heading of richTextHeadingIds(shown[field.key]))
        ids.add(heading)
    }
    headingCache.set(key, ids)
    return ids
  }

  function resolve(
    target: EntryLinkTarget,
    locale: string | null,
  ): EntryLinkResolution {
    const live = includedById.get(target.entryId)
    if (live && live.routePattern !== '') {
      const placed = placeLinkTarget(live, languages, locale)
      const targetTitle = entryTitle(placed.view, live.fields, placed.slug)
      const sectionFound =
        target.anchor !== null &&
        headingIdsOf(target.entryId, live, placed.language).has(target.anchor)
      return {
        href: entryLinkPath(
          placed.route,
          placed.slug,
          sectionFound ? target.anchor : null,
        ),
        ...(target.anchor && !sectionFound
          ? { reason: 'missing-section' as const }
          : {}),
        targetTitle,
        locale: placed.language,
      }
    }
    const row = linkTargets.get(target.entryId)
    if (!row || row.collectionKind === 'global' || row.routePattern === '') {
      return { href: null, reason: 'missing', targetTitle: '' }
    }
    return {
      href: null,
      reason: 'not-live',
      targetTitle: entryTitle(row.draftData, row.fields, row.slug),
    }
  }

  return {
    linksFor: (source) => ({
      resolve,
      report(field, locale, issues) {
        for (const issue of issues) {
          warnings.set(
            [
              source.id,
              locale ?? '',
              field,
              issue.entryId,
              issue.anchor ?? '',
              issue.reason,
            ].join('|'),
            {
              sourceEntryId: source.id,
              sourceTitle: source.title,
              sourceCollectionKey: source.collectionKey,
              sourceGlobal: source.global,
              locale,
              field,
              targetEntryId: issue.entryId,
              targetTitle: issue.targetTitle,
              anchor: issue.anchor,
              reason: issue.reason,
            },
          )
        }
      },
    }),
    warnings: () => [...warnings.values()],
  }
}
