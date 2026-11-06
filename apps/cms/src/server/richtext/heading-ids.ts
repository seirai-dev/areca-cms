/**
 * Heading ids, computed the way `@tanstack/markdown` computes them for
 * `parseMarkdown` (its slugger is not exported). A section link `#faq` must
 * match the id a site gets from the same heading, whether it renders the
 * `document` the CMS ships or parses Markdown itself. heading-ids.test.ts
 * checks this against the library.
 */

/** The library's heading slug: ASCII letters, digits and hyphens. */
export function headingSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&[a-z0-9#]+;/gi, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

/**
 * One id generator per document. A repeated heading gets `-2`, `-3`, … in
 * document order, as the library does.
 */
export function createHeadingIds(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const base = headingSlug(text)
    let count = seen.get(base) ?? 1
    let id = base
    while (seen.has(id)) id = `${base}-${++count}`
    seen.set(base, count)
    seen.set(id, 1)
    return id
  }
}
