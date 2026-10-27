import type { MarkdownDocument } from '@tanstack/markdown'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'date'
  | 'datetime'
  | 'select'
  | 'reference'
  | 'slug'
  | 'boolean'
  | 'number'
  | 'url'

type FieldBase = {
  key: string
  label: string
  required?: boolean
  description?: string
  /** Visual heading in the CMS editor, site content only. Stays flat in the SDK. */
  group?: string
  /**
   * Stored per language. Absent means the type default: text, textarea,
   * richtext and url are translatable; the others are shared.
   */
  translatable?: boolean
}

/**
 * Wire field, discriminated on `type`. `options` only exists on `select`,
 * `collection` is required on `reference`, `after` only on `date`/`datetime`.
 */
export type Field =
  | (FieldBase & {
      type: 'text' | 'textarea' | 'richtext' | 'image' | 'slug' | 'boolean' | 'number' | 'url'
    })
  | (FieldBase & { type: 'select'; options?: readonly string[] })
  | (FieldBase & { type: 'reference'; collection: string })
  | (FieldBase & {
      type: 'date' | 'datetime'
      /** Other date/datetime field key (same collection) that this value must be on or after. */
      after?: string
    })

export type CollectionConfig = {
  route: string
  label?: string
  fields: readonly Field[]
  /** Per-language route patterns, e.g. `{ nl: '/vacatures/$slug' }`. Each must contain `$slug`. */
  routes?: Readonly<Record<string, string>>
  /** Languages besides the main one that must be complete before the entry goes live. */
  requiredLanguages?: readonly string[]
}

/**
 * A site content section: a single-instance set of fields (company info,
 * home-page copy). Like a collection, but with no slug and no route.
 */
export type GlobalConfig = {
  label?: string
  /** No `slug` fields. `group` is allowed. */
  fields: readonly Field[]
  /** Gives the section a `$seo` panel, exposed as `$seo` on the SDK value. Default `false`. */
  seo?: boolean
  /** Page that previews the section, e.g. `/about`. */
  previewPath?: string
  /** Languages besides the main one that must be complete before the section goes live. */
  requiredLanguages?: readonly string[]
}

/** Site languages. `main` is the fallback; `all` is ordered and includes `main`. */
export type SiteLanguages = {
  main: string
  all: readonly string[]
}

export type SiteContentConfig = {
  siteKey: string
  /** Content languages. Omit to leave the site's language setting alone (single-language). */
  languages?: SiteLanguages
  collections: Record<string, CollectionConfig>
  /** Site content sections, keyed by raw CMS key. */
  globals?: Record<string, GlobalConfig>
  /** Where `areca pull` copies media. Local only: never sent to the CMS. */
  assets?: AssetsConfig
  /** SDK-only settings, never sent to the CMS. */
  i18n?: I18nConfig
}

/**
 * SDK-only language settings. `paraglide` is the Paraglide runtime module
 * (e.g. `./src/paraglide/runtime.js`). `areca pull` then passes its `getLocale`
 * to the generated content object.
 */
export type I18nConfig = {
  paraglide?: string
}

/**
 * Media handling for `areca pull`. By default every file the content uses is
 * downloaded into `public/areca` and the content points at `/areca/...`, so
 * the site never requests anything from the CMS.
 */
export type AssetsConfig = {
  /** Default `true`. `false` keeps URLs pointing at the CMS. */
  download?: boolean
  /** Directory relative to the project root. Default `public/areca`. */
  dir?: string
  /**
   * URL path the site serves `dir` from. Derived for directories under
   * `public/` (`public/areca` is served from `/areca`); required otherwise.
   */
  publicPath?: string
}

/** POST /api/sites/manifest body */
export type SiteManifest = {
  /** Omitted leaves the site's language setting alone. */
  languages?: SiteLanguages
  collections: Record<string, CollectionConfig>
  /** Omitted when there are no enabled site content sections. */
  globals?: Record<string, GlobalConfig>
}

/**
 * Published rich text. `markdown` is an interoperable export, `document`
 * preserves the editor as a TanStack Markdown AST (render with
 * `@tanstack/markdown/react` or `renderHtml`), and `html` is a static
 * fallback rendered from the same AST.
 */
export type RichTextValue = {
  json: unknown
  markdown: string
  document: MarkdownDocument
  html: string
}

export type ImageValue = {
  url: string
  width: number | null
  height: number | null
  alt: string
  mimeType: string
}

export type ReferenceValue<C extends string = string> = {
  collection: C
  slug: string
  id: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
  /** Camel collection key. Set by `areca pull` on every pulled entry. */
  collection?: string
  /**
   * Resolved SEO/GEO head data. CMS versions with SEO support always send it;
   * snapshots from older CMS versions do not have it.
   */
  seo?: SeoMeta
  /** Language of `data`, `slug` and `seo`. Absent on single-language sites and old snapshots. */
  locale?: string
  /** Complete languages only, main included when complete. Absent on single-language sites and old snapshots. */
  locales?: Record<string, LocalizedValues>
}

/** One language of an entry or site content section, as published. */
export type LocalizedValues = {
  /** Per-language slug. Only on collection entries. */
  slug?: string
  /** Full flat view: shared and translatable fields, camel-cased by `areca pull`. */
  data: Record<string, unknown>
  seo?: SeoMeta
}

/** Wire contract: matches the CMS `SeoMeta`. */
export type SeoMeta = {
  /** Page title without any site suffix. */
  title: string
  description: string | null
  canonicalUrl: string | null
  robots: { index: boolean; follow: boolean; content: string }
  focusKeyphrase: string | null
  openGraph: {
    type: 'article' | 'website'
    title: string
    description: string | null
    url: string | null
    siteName: string
    image: ImageValue | null
    publishedTime: string | null
    modifiedTime: string | null
  }
  twitter: {
    card: 'summary' | 'summary_large_image'
    title: string
    description: string | null
    image: ImageValue | null
  }
  author: { name: string; url: string | null; bio: string | null } | null
  /** TL;DR for answer engines; render it visibly on the page. */
  summary: string | null
  keyTakeaways: string[]
  faq: { question: string; answer: string }[]
  about: { name: string; sameAs: string | null }[]
  /** Ready-to-embed JSON-LD objects (main type, FAQPage, extras). */
  jsonLd: Record<string, unknown>[]
}

export type Snapshot = {
  /** Null for a development environment's live pull (no publication). */
  publicationId: string | null
  siteKey: string
  createdAt: string
  hash: string
  /** Content languages. Absent on single-language sites. */
  languages?: SiteLanguages
  collections: Record<string, SnapshotEntry[]>
  /** Every media file the content references. Absent from older CMS versions. */
  assets?: SnapshotAsset[]
  /** The site's production URL, used to make SEO image URLs absolute. */
  siteUrl?: string | null
  /**
   * Field schema for exactly the collections in `collections`, keyed by raw
   * CMS key. Absent from publications made before schemas were embedded.
   */
  schema?: Record<string, CollectionConfig>
  /** Enabled site content sections, keyed by raw CMS key. Absent when there are none. */
  globals?: Record<string, SnapshotGlobal>
  /** Schema for exactly the sections in `globals`, keyed by raw CMS key. */
  globalSchema?: Record<string, GlobalConfig>
}

/** One site content section as published. */
export type SnapshotGlobal = {
  /** Entry id. */
  id: string
  publishedAt: string | null
  /** Raw CMS keys, same value encoding as entries. */
  data: Record<string, unknown>
  /** Only when the section has SEO enabled. */
  seo?: SeoMeta
  /** Language of `data` and `seo`. Absent on single-language sites and old snapshots. */
  locale?: string
  /** Complete languages only, main included when complete. */
  locales?: Record<string, LocalizedValues>
}

/** A media file referenced by a publication. */
export type SnapshotAsset = {
  id: string
  /** Content URLs for this file end in `/api/assets/file/<storageKey>`. */
  storageKey: string
  url: string
  filename: string
  mimeType: string
  size: number
}

/** Completeness of one site language in a draft preview. */
export type PreviewLocaleStatus = {
  complete: boolean
  /** Labels of the missing required fields, e.g. `Title`. */
  missing: string[]
}

/**
 * A draft entry in preview. `locales` has the snapshot shape (shipped
 * languages only); `localeStatus` lists every site language. Both are absent
 * on single-language sites.
 */
export type PreviewSnapshotEntry = SnapshotEntry & {
  localeStatus?: Record<string, PreviewLocaleStatus>
}

/** A draft section in preview. Same language fields as `PreviewSnapshotEntry`. */
export type PreviewSnapshotGlobal = SnapshotGlobal & {
  localeStatus?: Record<string, PreviewLocaleStatus>
}

/** Preview of a collection entry. `kind` is missing from older CMS versions. */
export type PreviewEntryResult = {
  kind?: 'entry'
  collection: string
  slug: string
  entry: PreviewSnapshotEntry
}

/** Preview of a site content section. */
export type PreviewGlobalResult = {
  kind: 'global'
  /** Raw CMS key of the section. */
  global: string
  entry: PreviewSnapshotGlobal
}

export type PreviewResult = PreviewEntryResult | PreviewGlobalResult

export type PulledContentManifest = {
  /** Null for a development environment's live pull. */
  publicationId: string | null
  hash: string
  createdAt: string
  collections: Record<string, number>
  /** Camel keys of the site content sections in `_globals.json`. Absent when there are none. */
  globals?: string[]
  /** The site's content languages. Absent on single-language sites. */
  languages?: SiteLanguages
  /** Immutable directory under `.publications`; absent in legacy flat output. */
  generation?: string
  /** Present when media was copied locally. */
  assets?: {
    /** URL path the content uses for media, e.g. `/areca`. */
    publicPath: string
    count: number
  }
}
