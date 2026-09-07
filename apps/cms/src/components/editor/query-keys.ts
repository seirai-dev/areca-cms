export const queryKeys = {
  collections: (siteId: string) => ['collections', siteId] as const,
  entries: (
    siteId: string,
    collectionKey: string,
    filters?: { status?: string; search?: string },
  ) => ['entries', siteId, collectionKey, filters ?? {}] as const,
  entry: (id: string) => ['entry', id] as const,
  revisions: (entryId: string) => ['revisions', entryId] as const,
  assets: (organizationId: string, search?: string) =>
    ['assets', organizationId, search ?? ''] as const,
  releaseStatus: (siteId: string) => ['release-status', siteId] as const,
  publications: (siteId: string) => ['publications', siteId] as const,
  buildJobs: (siteId: string) => ['build-jobs', siteId] as const,
  buildJob: (id: string) => ['build-job', id] as const,
  previewUrl: (siteId: string, collection: string, slug: string) =>
    ['preview-url', siteId, collection, slug] as const,
}
