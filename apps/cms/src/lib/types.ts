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
  /** TanStack Markdown AST parsed from `markdown`. */
  document: MarkdownDocument
  html: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
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
