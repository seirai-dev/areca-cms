/**
 * Go‑live validation errors arrive as strings shaped like
 * `collection/slug: field: message` (see server/content/snapshot.ts). Parse
 * them into parts so the checklist can name the entry and link to it.
 */
export type GoLiveError = {
  raw: string
  collection?: string
  slug?: string
  field?: string
  message: string
}

const ENTRY_ERROR =
  /^([A-Za-z0-9_-]+)\/([^:]+):\s(?:([A-Za-z0-9_.[\]-]+):\s)?(.+)$/

export function parseGoLiveError(raw: string): GoLiveError {
  const match = raw.match(ENTRY_ERROR)
  if (!match) return { raw, message: raw }
  const [, collection, slug, field, message] = match
  return { raw, collection, slug: slug.trim(), field, message }
}
