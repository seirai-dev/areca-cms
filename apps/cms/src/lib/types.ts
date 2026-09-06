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

export type Field = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  collection?: string
  description?: string
}

export type MembershipRole = 'owner' | 'editor'

export type EntryStatus = 'draft' | 'published' | 'scheduled' | 'archived'

export type PublicationStatus =
  | 'pending'
  | 'building'
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
  html: string
  markdown: string
}

export type SnapshotEntry = {
  id: string
  slug: string
  data: Record<string, unknown>
  publishedAt: string | null
}

export type Snapshot = {
  siteId: string
  createdAt: string
  collections: Record<string, SnapshotEntry[]>
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
