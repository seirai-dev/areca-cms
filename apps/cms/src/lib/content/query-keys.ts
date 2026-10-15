export const queryKeys = {
  collections: (siteId: string) => ['collections', siteId] as const,
  entries: (
    siteId: string,
    collectionKey: string,
    filters?: {
      status?: string
      search?: string
      missingLanguage?: string
      referenceTargets?: boolean
      offset?: number
    },
  ) => ['entries', siteId, collectionKey, filters ?? {}] as const,
  inboundReferences: (entryId: string) =>
    ['inbound-references', entryId] as const,
  entry: (id: string) => ['entry', id] as const,
  revisions: (entryId: string) => ['revisions', entryId] as const,
  assets: (organizationId: string, search?: string, offset = 0) =>
    ['assets', organizationId, search ?? '', offset] as const,
  asset: (id: string) => ['asset', id] as const,
  releaseStatus: (siteId: string) => ['release-status', siteId] as const,
  publications: (siteId: string) => ['publications', siteId] as const,
  buildJobs: (siteId: string) => ['build-jobs', siteId] as const,
  buildJob: (id: string) => ['build-job', id] as const,
  aiAvailability: () => ['ai-availability'] as const,
  previewUrl: (siteId: string, collection: string, slug: string) =>
    ['preview-url', siteId, collection, slug] as const,
}
