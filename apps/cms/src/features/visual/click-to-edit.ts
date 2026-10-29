/**
 * Click to edit (docs/design/visual-editor.md, Decisions 12-17): the pure part.
 * Maps the markers a preview page reports to CMS fields and verified owners, and
 * builds the list of targets the bridge may outline and open.
 */
import { SEO_KEY } from '#/lib/seo'
import type { ResolvedOwner } from '#/server/content/preview-owners'

import { markerKey, ownerKey } from './protocol'
import type { Marker, MarkerOwner, MarkerTarget } from './protocol'

/** Most other owners verified in one call (the server's limit). */
export const OWNERS_MAX = 100

/** The document being edited: an entry, or a site content section. */
export type SelfIdentity = { entryId: string | null; globalKey: string | null }

/** `company_info` → `companyInfo`; the SDK's rule for the keys a site sees. */
export function toCamelKey(raw: string): string {
  const [first = '', ...rest] = raw
    .split(/[-_]/)
    .filter((part) => part.length > 0)
  return (
    first + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join('')
  )
}

/**
 * The CMS field key a marker names: an exact key, the camelCase name a site
 * sees (`heroImage` for `hero_image`), or `seo.x` for `$seo.x`. Null when no
 * field matches, so the marker behaves as unmarked.
 */
export function resolveFieldKey(
  field: string,
  fieldKeys: readonly string[],
): string | null {
  if (fieldKeys.includes(field)) return field
  if (field.startsWith('seo.')) {
    const seo = `${SEO_KEY}.${field.slice(4)}`
    return fieldKeys.includes(seo) ? seo : null
  }
  if (field.startsWith(`${SEO_KEY}.`)) return null
  return fieldKeys.find((key) => toCamelKey(key) === field) ?? null
}

/** True when a marker's owner is the document being edited (or it has none). */
export function isSelfOwner(
  owner: MarkerOwner | null,
  self: SelfIdentity,
): boolean {
  if (owner === null) return true
  if ('entry' in owner)
    return self.entryId !== null && owner.entry === self.entryId
  return (
    self.globalKey !== null &&
    (owner.global === self.globalKey ||
      toCamelKey(owner.global) === toCamelKey(self.globalKey))
  )
}

/** The distinct owners other than the page itself, sorted, at most `OWNERS_MAX`. */
export function otherOwners(
  markers: readonly Marker[],
  self: SelfIdentity,
): MarkerOwner[] {
  const byKey = new Map<string, MarkerOwner>()
  for (const marker of markers) {
    if (marker.owner === null || isSelfOwner(marker.owner, self)) continue
    byKey.set(ownerKey(marker.owner), marker.owner)
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, OWNERS_MAX)
    .map(([, owner]) => owner)
}

export type BuiltTargets = {
  /** What the bridge may outline and open, with chip labels. */
  targets: MarkerTarget[]
  /** markerKey → CMS field key, for the page's own markers. */
  fieldOf: Map<string, string>
  /** CMS field key → the first own marker showing it, as the page wrote it. */
  markerOf: Map<string, Marker>
  /** ownerKey → verified owner, for markers of other entries or sections. */
  ownerOf: Map<string, ResolvedOwner>
}

/**
 * The targets for a page's markers. Own markers need a matching field; other
 * owners need a verified answer (`owners` maps ownerKey → resolved or null;
 * missing means not checked yet). Everything else is left out.
 */
export function buildTargets(
  markers: readonly Marker[],
  options: {
    fieldKeys: readonly string[]
    labelOf: (fieldKey: string) => string
    self: SelfIdentity
    owners: ReadonlyMap<string, ResolvedOwner | null>
    ownerLabel: (owner: ResolvedOwner) => string
  },
): BuiltTargets {
  const targets: MarkerTarget[] = []
  const fieldOf = new Map<string, string>()
  const markerOf = new Map<string, Marker>()
  const ownerOf = new Map<string, ResolvedOwner>()
  for (const marker of markers) {
    if (isSelfOwner(marker.owner, options.self)) {
      const key = resolveFieldKey(marker.field, options.fieldKeys)
      if (key === null) continue
      fieldOf.set(markerKey(marker), key)
      if (!markerOf.has(key)) markerOf.set(key, marker)
      targets.push({ ...marker, label: options.labelOf(key) })
      continue
    }
    const ownerId = ownerKey(marker.owner)
    const resolved = options.owners.get(ownerId)
    if (!resolved) continue
    ownerOf.set(ownerId, resolved)
    targets.push({ ...marker, label: options.ownerLabel(resolved) })
  }
  return { targets, fieldOf, markerOf, ownerOf }
}

/** The page's own marker that shows a CMS field, as the page wrote it, or null. */
export function markerForField(
  fieldKey: string,
  built: Pick<BuiltTargets, 'markerOf'>,
): Marker | null {
  return built.markerOf.get(fieldKey) ?? null
}

function pageOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.origin === 'null') return null
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** True when the frame shows another page than the entry's preview (query ignored). */
export function isAwayFrom(
  pageUrl: string | null | undefined,
  previewUrl: string | null | undefined,
): boolean {
  if (!pageUrl || !previewUrl) return false
  const here = pageOf(pageUrl)
  const home = pageOf(previewUrl)
  return here !== null && home !== null && here !== home
}
