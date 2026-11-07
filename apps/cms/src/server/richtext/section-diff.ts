import type { HeadingSnapshot, SectionSnapshots } from '#/lib/types'

/**
 * What a save did to the headings that links point to (docs/design/rich-text-links.md,
 * decision 21). Pure: no database, so the rules are unit-tested on their own.
 */

/** The key of one rich text value in `SectionSnapshots`. */
export function sectionKey(locale: string, fieldKey: string): string {
  return `${locale}|${fieldKey}`
}

/**
 * One heading that links point to, and that a save removed or renamed. `from`
 * is the section id the links carry. `to` is the id of the heading now at the
 * same position when it is a rename, else null (removed). `headings` are the
 * headings of the value now, in order, for the removal choice.
 */
export type SectionChange = {
  locale: string
  from: string
  fromText: string
  to: string | null
  toText: string | null
  headings: HeadingSnapshot[]
}

/**
 * Compares the headings before and after a save, per rich text value. An old
 * heading whose id is still there (anywhere, so a move is not a change) is
 * kept. Any other old heading is a rename when the heading at the same position
 * is new, and a removal otherwise. Ids are unique within a value (the id
 * generator numbers repeats), so an id names one heading. A value's change is
 * kept once per language and id: two fields that share a heading id are one
 * section for the links, which carry no field.
 */
export function diffSectionSnapshots(
  before: SectionSnapshots,
  after: SectionSnapshots,
): SectionChange[] {
  const changes: SectionChange[] = []
  const seen = new Set<string>()
  for (const key of Object.keys(before)) {
    const previous = before[key] ?? []
    const next = after[key] ?? []
    const locale = localeOf(key)
    const previousIds = new Set(previous.map((heading) => heading.id))
    const nextIds = new Set(next.map((heading) => heading.id))
    previous.forEach((heading, index) => {
      if (nextIds.has(heading.id)) return
      const seenKey = `${locale}|${heading.id}`
      if (seen.has(seenKey)) return
      seen.add(seenKey)
      const atSamePosition = next.at(index)
      const renamed =
        atSamePosition !== undefined && !previousIds.has(atSamePosition.id)
      changes.push({
        locale,
        from: heading.id,
        fromText: heading.text,
        to: renamed ? atSamePosition.id : null,
        toText: renamed ? atSamePosition.text : null,
        headings: next,
      })
    })
  }
  return changes
}

/** The language part of a `sectionKey` ('' on a single-language site). */
export function localeOf(key: string): string {
  const cut = key.indexOf('|')
  return cut === -1 ? '' : key.slice(0, cut)
}
