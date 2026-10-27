/**
 * URL collisions between entries, for the push plan and the copy (docs/design/
 * dev-environments.md, "Plan" and "Copy to production"). Pure: no database.
 *
 * The rules mirror the content layer. A main slug must be unique in its
 * collection. A localized slug (`$i18n.<locale>.$slug`) must not match another
 * entry's main slug, nor that entry's slug in the same language. A main slug
 * is not compared with other entries' localized slugs.
 */
import { I18N_KEY, SLUG_KEY } from '#/lib/content-locale'
import type { EntryData } from '#/lib/types'

/** An entry as far as its URLs go. */
export type SlugOwner = {
  id: string
  /** What the UI calls the entry (display only). */
  title: string
  slug: string
  draftData: EntryData
}

/** One URL that another entry already holds. */
export type SlugCollision = {
  /** Set for a localized slug; absent for the main slug. */
  locale?: string
  slug: string
  /** Title of the entry that holds the URL. */
  collidesWith: string
}

type Candidate = { locale?: string; slug: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The localized slug an entry holds in one language, or undefined. */
function localizedSlug(data: EntryData, locale: string): string | undefined {
  const translations = data[I18N_KEY]
  if (!isPlainObject(translations)) return undefined
  const slot = translations[locale]
  if (!isPlainObject(slot)) return undefined
  const slug = slot[SLUG_KEY]
  return typeof slug === 'string' && slug !== '' ? slug : undefined
}

/** Every URL an entry writes: its main slug and each non-empty localized slug. */
export function slugCandidates(entry: {
  slug: string
  draftData: EntryData
}): Candidate[] {
  const out: Candidate[] = [{ slug: entry.slug }]
  const translations = entry.draftData[I18N_KEY]
  if (isPlainObject(translations)) {
    for (const locale of Object.keys(translations)) {
      const slug = localizedSlug(entry.draftData, locale)
      if (slug !== undefined) out.push({ locale, slug })
    }
  }
  return out
}

function holds(owner: SlugOwner, candidate: Candidate): boolean {
  if (owner.slug === candidate.slug) return true
  if (candidate.locale === undefined) return false
  return localizedSlug(owner.draftData, candidate.locale) === candidate.slug
}

/**
 * The URLs of `entry` that an entry in `others` already holds, one per URL.
 * `others` must not contain `entry` itself.
 */
export function findSlugCollisions(
  entry: { slug: string; draftData: EntryData },
  others: SlugOwner[],
): SlugCollision[] {
  const collisions: SlugCollision[] = []
  for (const candidate of slugCandidates(entry)) {
    const owner = others.find((other) => holds(other, candidate))
    if (!owner) continue
    collisions.push({
      ...(candidate.locale !== undefined ? { locale: candidate.locale } : {}),
      slug: candidate.slug,
      collidesWith: owner.title,
    })
  }
  return collisions
}
