/**
 * Slugs for development environments (docs/design/dev-environments.md, Edge
 * case 8). Pure: no database imports, so it is unit-tested directly.
 */

/** How many candidate slugs a fork tries before it gives up. */
export const DEV_SLUG_ATTEMPTS = 50

/**
 * `<slug>-dev`, then `<slug>-dev-2`, `<slug>-dev-3`, and so on, in order.
 */
export function devSlugCandidates(
  slug: string,
  attempts: number = DEV_SLUG_ATTEMPTS,
): string[] {
  const base = `${slug}-dev`
  return Array.from({ length: attempts }, (_, index) =>
    index === 0 ? base : `${base}-${index + 1}`,
  )
}

/**
 * The first candidate that `isTaken` does not report as taken, or null when
 * every candidate is taken.
 */
export function pickDevSlug(
  slug: string,
  isTaken: (candidate: string) => boolean,
): string | null {
  return (
    devSlugCandidates(slug).find((candidate) => !isTaken(candidate)) ?? null
  )
}
