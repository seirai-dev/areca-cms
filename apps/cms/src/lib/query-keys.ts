/**
 * Every React Query key of the app. Keys that share a prefix are refreshed
 * together by one invalidation of that prefix, so build keys (and prefixes)
 * from here rather than writing array literals.
 */

/** Third key segment of the overview lists; collection keys never contain a space. */
export const OVERVIEW_ENTRIES = ' overview'

export const queryKeys = {
  me: () => ['me'] as const,

  // Content
  collections: (siteId: string) => ['collections', siteId] as const,
  /** Entries per collection of one site (sidebar and mobile bar). */
  entryCounts: (siteId: string) => ['entry-counts', siteId] as const,
  /**
   * Prefix of a site's entry lists, or of one collection's lists. The
   * overview's lists sit under `entriesOf(siteId, OVERVIEW_ENTRIES)`.
   */
  entriesOf: (siteId: string, collectionKey?: string) =>
    collectionKey === undefined
      ? (['entries', siteId] as const)
      : (['entries', siteId, collectionKey] as const),
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
  /** The command palette's per-collection search. */
  paletteSearch: (
    siteId: string | undefined,
    collectionKey: string,
    needle: string,
  ) => ['palette-search', siteId, collectionKey, needle] as const,
  inboundReferences: (entryId: string) =>
    ['inbound-references', entryId] as const,
  linkedFrom: (entryId: string) => ['linked-from', entryId] as const,
  /**
   * Entry caches are keyed by id only (no site in the key), so this prefix is
   * the only way to reach every entry a site owns.
   */
  entryFamily: () => ['entry'] as const,
  entry: (id: string) => ['entry', id] as const,
  /** Under `entry(id)`, so whatever refreshes the entry refreshes its title. */
  entryTitle: (id: string) => ['entry', id, 'title'] as const,
  /** Entry titles and slugs for the activity feed, per chunk of ids. */
  activityEntries: (ids: readonly string[]) =>
    ['activity-entries', ids] as const,
  /**
   * Rich text link targets: the link field's search, headings and checks. All
   * under `['link-targets', siteId]`, so a save can refresh them together.
   */
  linkTargets: (siteId: string) => ['link-targets', siteId] as const,
  linkSearch: (
    siteId: string,
    locale: string | null,
    query: string,
    limit: number,
  ) => ['link-targets', siteId, 'search', locale ?? '', query, limit] as const,
  linkHeadings: (siteId: string, entryId: string, locale: string | null) =>
    ['link-targets', siteId, 'headings', entryId, locale ?? ''] as const,
  linkChecks: (siteId: string, locale: string | null, links: string) =>
    ['link-targets', siteId, 'checks', locale ?? '', links] as const,
  revisions: (entryId: string) => ['revisions', entryId] as const,
  previewUrl: (siteId: string, collection: string, slug: string) =>
    ['preview-url', siteId, collection, slug] as const,
  previewOwners: (siteId: string, owners: readonly string[]) =>
    ['preview-owners', siteId, owners] as const,
  /** Entries holding content per field key; `fieldDataUsage(siteId)` is the site's prefix. */
  fieldDataUsage: (siteId: string, collectionKey?: string) =>
    collectionKey === undefined
      ? (['field-data-usage', siteId] as const)
      : (['field-data-usage', siteId, collectionKey] as const),

  // Site content (globals)
  /**
   * A site's sections. Settings, the sidebar, the palette and the section
   * editor share it: invalidate it after any section change.
   */
  globals: (siteId: string) => ['globals', siteId] as const,
  /** Prefix of every section editor of one site. */
  globalFamily: (siteId: string) => ['global', siteId] as const,
  global: (siteId: string, key: string) => ['global', siteId, key] as const,
  globalPreview: (siteId: string, key: string) =>
    ['global-preview', siteId, key] as const,

  // Media. Every asset list of a client shares `assetsOf(organizationId)`.
  assetsOf: (organizationId: string) => ['assets', organizationId] as const,
  libraryAssets: (
    organizationId: string,
    search: string,
    missingAlt: unknown,
  ) =>
    ['assets', organizationId, 'library', search, missingAlt ?? null] as const,
  pickerAssets: (organizationId: string, search: string, imagesOnly: boolean) =>
    ['assets', organizationId, 'picker', search, imagesOnly] as const,
  asset: (id: string) => ['asset', id] as const,

  // Go live
  releaseStatus: (siteId: string) => ['release-status', siteId] as const,
  publications: (siteId: string) => ['publications', siteId] as const,
  buildJobs: (siteId: string) => ['build-jobs', siteId] as const,
  buildJob: (id: string) => ['build-job', id] as const,
  /** The go-live tray's pending list of one site. */
  goLivePending: (siteId: string) => ['golive-pending', siteId] as const,
  /** Go-live validation errors, kept in the cache so the tray and the panel share them. */
  goLiveErrors: (siteId: string) => ['golive-errors', siteId] as const,
  goLiveErrorEntry: (
    siteId: string,
    collection: string | undefined,
    slug: string | undefined,
  ) => ['golive-error-entry', siteId, collection, slug] as const,
  pausedJobs: () => ['agency', 'paused-jobs'] as const,

  // Sites and clients
  organizations: () => ['organizations'] as const,
  /** Every site the user can open, with its client (home, switcher). */
  sitesOverview: () => ['sites-overview'] as const,
  sites: (organizationId: string) => ['sites', organizationId] as const,
  site: (id: string) => ['site', id] as const,
  dokployCredentials: (organizationId: string) =>
    ['dokploy-credentials', organizationId] as const,
  dokployApplications: (organizationId: string) =>
    ['dokploy-credentials', organizationId, 'applications'] as const,
  cloudflareCredentials: (organizationId: string) =>
    ['cloudflare-credentials', organizationId] as const,
  cloudflareDeployTargets: (organizationId: string) =>
    ['cloudflare-credentials', organizationId, 'deploy-targets'] as const,
  devEnvironment: (siteId: string) => ['dev-environment', siteId] as const,
  /** Prefix of every dev site's push plan. */
  allPushPlans: () => ['push-plan'] as const,
  pushPlan: (devSiteId: string) => ['push-plan', devSiteId] as const,
  /** Prefix of every dev site's sync banner. */
  allDevSyncs: () => ['dev-sync'] as const,
  devSync: (devSiteId: string) => ['dev-sync', devSiteId] as const,

  // People
  members: (organizationId: string) => ['members', organizationId] as const,
  /** Prefix of every client's invitation list. */
  allInvitations: () => ['invitations'] as const,
  invitations: (organizationId: string) =>
    ['invitations', organizationId] as const,
  users: () => ['users'] as const,
  person: (userId: string) => ['person', userId] as const,
  pendingInvitations: () => ['pending-invitations'] as const,
  palettePeople: (needle: string) => ['palette-people', needle] as const,
  sessions: () => ['account', 'sessions'] as const,

  // Activity
  audit: (offset: number, organizationId?: string) =>
    ['audit', organizationId ?? 'all', offset] as const,
  activity: (organizationId?: string, siteId?: string) =>
    ['activity', organizationId ?? 'all', siteId ?? 'all'] as const,
  homeActivity: () => ['home-activity'] as const,

  // Notifications
  myNotifications: () => ['notifications', 'mine'] as const,
  orgNotificationRules: (organizationId: string) =>
    ['notifications', 'org-rules', organizationId] as const,
  agencyNotificationRules: () => ['notifications', 'agency-rules'] as const,

  // Agency settings
  mailSettings: () => ['mail-settings'] as const,
  mailHealth: () => ['mail-health'] as const,
  /** Recent mail; `mailRecent()` is the prefix of both filters. */
  mailRecent: (failedOnly?: boolean) =>
    failedOnly === undefined
      ? (['mail-recent'] as const)
      : (['mail-recent', failedOnly ? 'failed' : 'all'] as const),
  branding: () => ['branding'] as const,
  aiSettings: () => ['ai-settings'] as const,
  aiModels: () => ['ai-models'] as const,
  aiAvailability: () => ['ai-availability'] as const,

  // Connect AI
  mcpKeys: (siteId: string) => ['connect-ai', 'keys', siteId] as const,
  mcpConnections: (siteId: string) =>
    ['connect-ai', 'connections', siteId] as const,
  agencyMcpKeys: () => ['connect-ai', 'agency', 'keys'] as const,
  agencyMcpConnections: () => ['connect-ai', 'agency', 'connections'] as const,
}
