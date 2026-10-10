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

export type Field = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  collection?: string
  description?: string
  /** Other date/datetime field key that this value must be on or after. */
  after?: string
}

export type MembershipRole = 'owner' | 'editor'

export type EntryStatus = 'draft' | 'published' | 'scheduled' | 'archived'

export type PublicationStatus =
  | 'pending'
  | 'building'
  | 'demo'
  | 'live'
  | 'failed'
  | 'superseded'
  | 'rolled_back'

export type BuildJobStatus =
  | 'queued'
  | 'building'
  | 'validating'
  | 'deploying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type DeploymentTarget = {
  provider: 'dokploy'
  applicationId: string
  healthCheckUrl?: string
}

export type SnapshotRichText = {
  json: unknown
  markdown: string
  /** TanStack Markdown AST preserving the validated visual editor structure. */
  document: MarkdownDocument
  html: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
  /**
   * Resolved SEO/GEO head data — matches `@areca-cms/site-sdk` `SeoMeta`.
   * Always set by current builds; absent in publications stored before it.
   */
  seo?: SeoMeta
}

/** Wire contract — matches `@areca-cms/site-sdk` `SeoMeta`. */
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

/** Wire contract — matches `@areca-cms/site-sdk` `Snapshot`. */
export type Snapshot = {
  publicationId: string
  siteKey: string
  createdAt: string
  hash: string
  collections: Record<string, SnapshotEntry[]>
}

export type ImageValue = {
  url: string
  width: number | null
  height: number | null
  alt: string
  mimeType: string
}

export type ReferenceValue = {
  collection: string
  slug: string
  id: string
}

export type SiteManifest = {
  collections: Record<
    string,
    {
      route: string
      label?: string
      fields: Field[]
    }
  >
}

export type EntryData = Record<string, unknown>

export type AuditMeta = Record<string, unknown>
