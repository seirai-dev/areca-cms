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

export type CollectionConfig = {
  route: string
  label?: string
  fields: Field[]
}

export type SiteContentConfig = {
  siteKey: string
  collections: Record<string, CollectionConfig>
}

/** POST /api/sites/manifest body */
export type SiteManifest = {
  collections: Record<string, CollectionConfig>
}

export type RichTextValue = {
  json: unknown
  html: string
  markdown: string
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

export type SnapshotEntry = {
  id: string
  slug: string
  publishedAt: string | null
  data: Record<string, unknown>
}

export type Snapshot = {
  publicationId: string
  siteKey: string
  createdAt: string
  hash: string
  collections: Record<string, SnapshotEntry[]>
}

export type PreviewResult = {
  collection: string
  slug: string
  entry: SnapshotEntry
}

export type PulledContentManifest = {
  publicationId: string
  hash: string
  createdAt: string
  collections: Record<string, number>
}
