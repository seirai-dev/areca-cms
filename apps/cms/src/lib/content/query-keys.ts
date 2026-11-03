/** Third key segment of the overview lists; collection keys never contain a space. */
export const OVERVIEW_ENTRIES = ' overview'

export const queryKeys = {
  collections: (siteId: string) => ['collections', siteId] as const,
  /** Entries per collection of one site (sidebar and mobile bar). */
  entryCounts: (siteId: string) => ['entry-counts', siteId] as const,
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
  /**
   * The overview's site-wide lists. Under `['entries', siteId]`, so anything
   * that invalidates a site's entries refreshes them; a save invalidates them
   * by this key (`OVERVIEW_ENTRIES`).
   */
  recentEntries: (siteId: string, list: 'recent' | 'drafts-by-others') =>
    ['entries', siteId, OVERVIEW_ENTRIES, list] as const,
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
