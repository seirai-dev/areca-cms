import type { Field } from '#/lib/types'

/**
 * Hard-coded demo content for `pnpm db:demo`. Nothing here is generated:
 * the same input always produces the same clients, sites, entries and images.
 */

export type DemoImage = {
  /** Local name used by entries: `img:<key>` in image fields and Markdown. */
  key: string
  /** picsum.photos id; the file is fetched at 1600x1000 and cached. */
  picsumId: number
  /** Alt text. Omit to leave the asset without a description (library warning). */
  alt?: string
}

export type DemoEntry = {
  /** Lookup key for `ref:<collection>:<slug>` references. Defaults to data.slug. */
  slug: string
  /**
   * live: published before the first release, so it is on the site.
   * ready: approved after the first release, so it waits for the next go live.
   * scheduled: approved and set to publish at `scheduledAt`.
   * draft: never approved.
   */
  status: 'live' | 'ready' | 'draft' | 'scheduled'
  /** Field values. Rich text is Markdown; image fields use `img:<key>`; references use `ref:<collection>:<slug>`. */
  data: Record<string, unknown>
  /** Earlier versions of the draft (overlays on `data`), saved in order before the final one. */
  earlier?: Record<string, unknown>[]
  seo?: Record<string, unknown>
  /** Dutch values for translatable fields, on sites with the `nl` language. */
  nl?: Record<string, unknown>
  nlSeo?: Record<string, unknown>
  scheduledAt?: string
  timezone?: string
}

export type DemoCollection = {
  key: string
  label: string
  routePattern: string
  fields: Field[]
  entries: DemoEntry[]
}

export type DemoClient = {
  slug: string
  name: string
  domain: string
  owner: { name: string; email: string }
  editor: { name: string; email: string }
  /** An invitation nobody has accepted yet. */
  pendingInvite?: { email: string; role: 'owner' | 'editor' }
  site: { name: string; slug: string }
  languages?: { main: string; all: string[] }
  images: DemoImage[]
  /** Authors and other referenced collections first. */
  collections: DemoCollection[]
  /** One site content section (single value set). */
  global: {
    key: string
    label: string
    fields: Field[]
    values: Record<string, unknown>
  }
}
