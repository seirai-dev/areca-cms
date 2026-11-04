import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import type {
  AuditMeta,
  BuildJobStatus,
  ContentKind,
  DeploymentTarget,
  EntryData,
  EntryOriginBaseline,
  EntryStatus,
  EnvironmentPushKind,
  Field,
  MailSecure,
  MembershipRole,
  PublicationStatus,
  SchemaSnapshot,
  SiteEnvironment,
  SiteLanguages,
  SiteManifest,
  Snapshot,
} from '../lib/types.ts'
import type { AdvancedBrandColors } from '../lib/branding.ts'
import type {
  EventKey,
  NotificationPayload,
  NotificationRole,
} from '../lib/notifications.ts'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  isAgencyAdmin: boolean('is_agency_admin').notNull().default(false),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  /** Language for account and notification emails. Null = not chosen yet. */
  locale: text('locale').$type<'en' | 'nl' | 'tr'>(),
  /**
   * Suspended, not deleted: the person cannot sign in or use their keys and
   * connections until an agency admin unblocks them. Memberships are kept.
   */
  blockedAt: timestamptz('blocked_at'),
  blockedById: text('blocked_by_id').references((): AnyPgColumn => user.id, {
    onDelete: 'set null',
  }),
  /** Internal note for agency admins. Never shown to the blocked person. */
  blockedReason: text('blocked_reason'),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamptz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

/**
 * Better Auth two-factor plugin: one TOTP secret (encrypted) and the backup
 * codes (encrypted) per user. `verified` stays false until the first code is
 * confirmed during enrolment.
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count')
      .notNull()
      .default(0),
    lockedUntil: timestamptz('locked_until'),
  },
  (t) => [index('two_factor_user_id_idx').on(t.userId)],
)

/**
 * Required by the Better Auth SSO plugin. Connections themselves come from the
 * environment (`defaultSSO`), so this table stays empty in normal operation.
 */
export const ssoProvider = pgTable('sso_provider', {
  id: text('id').primaryKey(),
  issuer: text('issuer').notNull(),
  oidcConfig: text('oidc_config'),
  samlConfig: text('saml_config'),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull().unique(),
  organizationId: text('organization_id'),
  domain: text('domain').notNull(),
  // Added by the plugin's domain verification, which trusts emails on the
  // configured Microsoft domain (see `auth-providers.ts`).
  domainVerified: boolean('domain_verified').notNull().default(false),
})

export const organization = pgTable('organization', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Server-only deployment credentials. Never include encryptedApiKey in UI DTOs. */
export const dokployCredential = pgTable('dokploy_credential', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Server-only Cloudflare credentials. Never include encryptedApiToken in UI DTOs. */
export const cloudflareCredential = pgTable('cloudflare_credential', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  encryptedApiToken: text('encrypted_api_token').notNull(),
  tokenLast4: text('token_last4').notNull(),
  lastVerifiedAt: timestamp('last_verified_at', {
    withTimezone: true,
    mode: 'date',
  }),
  lastVerifyResult: jsonb('last_verify_result'),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const membership = pgTable(
  'membership',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').$type<MembershipRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('membership_user_org_unique').on(t.userId, t.organizationId)],
)

export const invitation = pgTable('invitation', {
  id: id(),
  email: text('email').notNull(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').$type<MembershipRole>().notNull(),
  /** SHA-256 of the invitation token. The raw token is never stored. */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamptz('expires_at').notNull(),
  acceptedAt: timestamptz('accepted_at'),
  /**
   * 'sent' once SMTP accepted the email; 'queued' while the outbox still
   * retries it; 'failed' keeps the row for resend.
   */
  deliveryStatus: text('delivery_status')
    .$type<'sent' | 'queued' | 'failed'>()
    .notNull()
    .default('sent'),
  lastDeliveryError: text('last_delivery_error'),
  lastSentAt: timestamptz('last_sent_at'),
  createdAt: createdAt(),
})

export const site = pgTable(
  'site',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    tokenHash: text('token_hash').notNull().unique(),
    schemaTokenHash: text('schema_token_hash').unique(),
    productionUrl: text('production_url').notNull(),
    /** Where previews and the visual editor load from. Null = productionUrl. */
    previewUrl: text('preview_url'),
    previewSecret: text('preview_secret').notNull(),
    publishingMode: text('publishing_mode')
      .$type<'production' | 'demo'>()
      .notNull()
      .default('production'),
    deploymentTarget: jsonb(
      'deployment_target',
    ).$type<DeploymentTarget | null>(),
    lastManifest: jsonb('last_manifest').$type<SiteManifest | null>(),
    /** Extra instructions appended to the AI SEO system prompt for this site. */
    aiPrompt: text('ai_prompt'),
    /** Content languages. Null = single-language site. */
    languages: jsonb('languages').$type<SiteLanguages | null>(),
    /** `development` sites are forks of a production site. */
    environment: text('environment')
      .$type<SiteEnvironment>()
      .notNull()
      .default('production'),
    /** Dev environments only: the production site this one was forked from. */
    parentSiteId: text('parent_site_id').references(
      (): AnyPgColumn => site.id,
      { onDelete: 'cascade' },
    ),
    /** Dev environments only: production schema at the last fork or push. */
    schemaBaseline: jsonb('schema_baseline').$type<SchemaSnapshot | null>(),
    /** Dev environments only: last fork or reset. */
    lastForkedAt: timestamptz('last_forked_at'),
    /** Dev environments only: last push or copy. */
    lastPushedAt: timestamptz('last_pushed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One development environment per production site.
    uniqueIndex('site_parent_site_id_unique')
      .on(t.parentSiteId)
      .where(sql`${t.parentSiteId} is not null`),
    check(
      'site_environment_production_check',
      sql`environment = 'production' or (parent_site_id is not null and publishing_mode = 'demo' and deployment_target is null)`,
    ),
    check(
      'site_environment_parent_check',
      sql`environment = 'development' or parent_site_id is null`,
    ),
  ],
)

export const collection = pgTable(
  'collection',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    routePattern: text('route_pattern').notNull(),
    fields: jsonb('fields').$type<Field[]>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** `global` rows are site content sections; each has one `$global` entry. */
    kind: text('kind').$type<ContentKind>().notNull().default('collection'),
    /** Globals only: resolved SEO is shipped. Collections always have SEO. */
    seoEnabled: boolean('seo_enabled').notNull().default(false),
    /** Globals only: site path that previews the section, e.g. `/about`. */
    previewPath: text('preview_path'),
    /** Languages besides main that must be complete before going live. */
    requiredLanguages: text('required_languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Collections only: per-language route patterns, e.g. `{ nl: '/vacatures/$slug' }`. */
    localizedRoutes: jsonb('localized_routes').$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('collection_site_key_unique').on(t.siteId, t.key)],
)

export const entry = pgTable(
  'entry',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collection.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    status: text('status').$type<EntryStatus>().notNull().default('draft'),
    draftData: jsonb('draft_data').$type<EntryData>().notNull().default({}),
    publishedData: jsonb('published_data').$type<EntryData | null>(),
    publishedSlug: text('published_slug'),
    draftVersion: integer('draft_version').notNull().default(1),
    /** Bumped on every write to this row (docs/design/dev-environments.md, Decision 12). */
    contentVersion: integer('content_version').notNull().default(1),
    /** Dev environments only: production entry this one was forked or pushed from. No foreign key, so the link survives production hard-deletes. */
    originEntryId: text('origin_entry_id'),
    /** Dev environments only: dev-side content at the last fork or push. */
    originBaseline: jsonb(
      'origin_baseline',
    ).$type<EntryOriginBaseline | null>(),
    /** Dev environments only: production `content_version` at the last fork or push. */
    originContentVersion: integer('origin_content_version'),
    scheduledData: jsonb('scheduled_data').$type<EntryData | null>(),
    scheduledSlug: text('scheduled_slug'),
    scheduledVersion: text('scheduled_version'),
    scheduledAt: timestamptz('scheduled_at'),
    scheduleTimezone: text('schedule_timezone'),
    scheduledBy: text('scheduled_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamptz('published_at'),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('entry_collection_slug_unique').on(t.collectionId, t.slug),
    index('entry_site_id_idx').on(t.siteId),
    // The scheduler's due scan reads only scheduled rows, by time.
    index('entry_scheduled_due_idx')
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled'`),
    // A collection list reads one collection's rows newest first (with the
    // slug as tie-break): the index returns them in that order, so a page
    // reads only its rows. The collection fixes the site, so it leads.
    index('entry_collection_updated_idx').on(
      t.collectionId,
      sql`${t.updatedAt} desc`,
      t.slug,
    ),
    // List search matches `slug ilike` or `draft_data::text ilike` (see
    // `listScope`). Trigram indexes answer both without reading every
    // document of the collection. Needs the pg_trgm extension (migration 0042).
    index('entry_slug_trgm_idx').using('gin', sql`${t.slug} gin_trgm_ops`),
    index('entry_draft_text_trgm_idx').using(
      'gin',
      sql`(${t.draftData}::text) gin_trgm_ops`,
    ),
  ],
)

export const entryRevision = pgTable(
  'entry_revision',
  {
    id: id(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entry.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<EntryData>().notNull(),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    note: text('note'),
    /**
     * `autosave`: a draft save. Saves by one person within a few minutes of
     * their last autosave update that revision. `milestone`: an action that
     * approves, schedules, publishes, restores or creates, always its own row.
     */
    kind: text('kind')
      .$type<'autosave' | 'milestone'>()
      .notNull()
      .default('milestone'),
  },
  (t) => [
    // History pages and the latest-revision lookup read one entry, newest first.
    index('entry_revision_entry_created_idx').on(t.entryId, t.createdAt, t.id),
    // Retention scans autosave rows by age.
    index('entry_revision_kind_created_idx').on(t.kind, t.createdAt),
  ],
)

/**
 * Log of fork, reset, push and copy actions between a production site and its
 * development environment. Listed on the production site.
 */
export const environmentPush = pgTable(
  'environment_push',
  {
    id: id(),
    devSiteId: text('dev_site_id').references(() => site.id, {
      onDelete: 'set null',
    }),
    productionSiteId: text('production_site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<EnvironmentPushKind>().notNull(),
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    counts: jsonb('counts').$type<Record<string, number>>().notNull(),
    items: jsonb('items').$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('environment_push_production_created_idx').on(
      t.productionSiteId,
      t.createdAt,
    ),
  ],
)

/** Authoring history retained after entry, collection, or site deletion. */
export const deletedContentArchive = pgTable('deleted_content_archive', {
  id: id(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  entityType: text('entity_type')
    .$type<'entry' | 'collection' | 'site'>()
    .notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
})

export const asset = pgTable(
  'asset',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    /** Uploads made through a site's AI connection remain available to that site. */
    originSiteId: text('origin_site_id').references(() => site.id, {
      onDelete: 'set null',
    }),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    altText: text('alt_text'),
    /** External URL a rich-text image was imported from; reused instead of downloading again. */
    sourceUrl: text('source_url'),
    /** Alt text per content language. `altText` stays the main-language alt. */
    altI18n: jsonb('alt_i18n')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('asset_org_source_url_unique')
      .on(t.organizationId, t.sourceUrl)
      .where(sql`${t.sourceUrl} is not null`),
    // The media library lists one organization's assets newest first.
    index('asset_organization_created_idx').on(
      t.organizationId,
      sql`${t.createdAt} desc`,
      sql`${t.id} desc`,
    ),
  ],
)

/**
 * A one-time upload link an AI connection hands out, so a person (browser
 * page) or the AI itself (curl) can send files without a public URL. Only the
 * SHA-256 of the link's token is kept.
 */
export const assetUploadSession = pgTable(
  'asset_upload_session',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    /** The person whose AI connection opened the session; uploads are theirs. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** What the AI asked for, shown on the upload page. */
    purpose: text('purpose'),
    maxFiles: integer('max_files').notNull(),
    /** Slots taken by finished and in-flight uploads; caps the session at maxFiles. */
    reservedCount: integer('reserved_count').notNull().default(0),
    expiresAt: timestamptz('expires_at').notNull(),
    finishedAt: timestamptz('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('asset_upload_session_site_id_idx').on(t.siteId),
    check(
      'asset_upload_session_reserved_check',
      sql`${t.reservedCount} >= 0 and ${t.reservedCount} <= ${t.maxFiles}`,
    ),
  ],
)

/** The assets uploaded through one session, in upload order. */
export const assetUploadSessionFile = pgTable(
  'asset_upload_session_file',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => assetUploadSession.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('asset_upload_session_file_unique').on(t.sessionId, t.assetId),
  ],
)

export const publication = pgTable(
  'publication',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot').$type<Snapshot>().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    entryVersions: jsonb('entry_versions')
      .$type<{ entryId: string; scheduledVersion: string }[]>()
      .notNull()
      .default([]),
    requestedBy: text('requested_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<PublicationStatus>().notNull(),
    publishingMode: text('publishing_mode')
      .$type<'production' | 'demo'>()
      .notNull()
      .default('production'),
    wasLive: boolean('was_live').notNull().default(false),
    /** What started the release: a person, the scheduler, or a rollback. */
    origin: text('origin')
      .$type<'manual' | 'scheduled' | 'rollback'>()
      .notNull()
      .default('manual'),
    /** Users who scheduled the entries this release ships. */
    scheduledBy: jsonb('scheduled_by').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    deployedAt: timestamptz('deployed_at'),
  },
  (t) => [
    index('publication_site_id_idx').on(t.siteId),
    // "Latest live release for this site" lookups.
    index('publication_site_status_idx').on(t.siteId, t.status),
  ],
)

export const buildJob = pgTable(
  'build_job',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publication.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(0),
    status: text('status').$type<BuildJobStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    dispatchStartedAt: timestamptz('dispatch_started_at'),
    dispatchTarget: jsonb('dispatch_target').$type<DeploymentTarget>(),
    deploymentResourceKey: text('deployment_resource_key'),
    dispatchConnectionUrl: text('dispatch_connection_url'),
    schedulerFingerprint: text('scheduler_fingerprint'),
    upstreamDeploymentId: text('upstream_deployment_id'),
    dispatchUncertain: boolean('dispatch_uncertain').notNull().default(false),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    logs: text('logs'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('build_job_status_idx').on(t.status),
    uniqueIndex('build_job_one_queued_per_site')
      .on(t.siteId)
      .where(sql`${t.status} = 'queued'`),
    uniqueIndex('build_job_one_active_per_site')
      .on(t.siteId)
      .where(sql`${t.status} IN ('building', 'validating', 'deploying')`),
    uniqueIndex('build_job_one_dispatch_per_resource')
      .on(t.deploymentResourceKey)
      .where(
        sql`${t.deploymentResourceKey} IS NOT NULL AND (${t.status} IN ('building', 'validating', 'deploying') OR ${t.dispatchUncertain})`,
      ),
  ],
)

/** Durable successful mutation identities; replay never enqueues or coalesces. */
export const publicationRequest = pgTable('publication_request', {
  id: text('id').primaryKey(),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  operation: text('operation').$type<'publish' | 'rollback'>().notNull(),
  payload: text('payload').notNull(),
  publicationId: text('publication_id')
    .notNull()
    .references(() => publication.id, { onDelete: 'cascade' }),
  /**
   * Null once retention has pruned the finished job. The record stays so a
   * replayed key still returns the publication it created.
   */
  jobId: text('job_id').references(() => buildJob.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

export const auditLog = pgTable('audit_log', {
  id: id(),
  /** Null for instance-level events (setup, branding, agency admin changes). */
  organizationId: text('organization_id').references(() => organization.id, {
    onDelete: 'cascade',
  }),
  siteId: text('site_id').references(() => site.id, { onDelete: 'set null' }),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  meta: jsonb('meta').$type<AuditMeta>(),
  /**
   * Agency-only rows: anything for a development environment, and `dev_env.*`
   * actions. Set by `audit()`. Client-facing activity filters on this flag, so
   * rows stay hidden after the dev env (and its site_id) is deleted.
   */
  agencyOnly: boolean('agency_only').notNull().default(false),
  createdAt: createdAt(),
})

/**
 * Instance-wide whitelabel settings. A single row with id `default`; every
 * nullable column falls back to the built-in Areca branding when unset.
 */
export const branding = pgTable('branding', {
  id: text('id').primaryKey(),
  appName: text('app_name'),
  logoKey: text('logo_key'),
  logoMime: text('logo_mime'),
  faviconKey: text('favicon_key'),
  faviconMime: text('favicon_mime'),
  accentColor: text('accent_color'),
  advancedColorsEnabled: boolean('advanced_colors_enabled')
    .notNull()
    .default(false),
  advancedColors: jsonb('advanced_colors').$type<AdvancedBrandColors>(),
  font: text('font'),
  emailFromName: text('email_from_name'),
  /** Per-locale sign-in tagline; a missing or null locale uses the built-in text. */
  loginTagline: jsonb('login_tagline').$type<{
    en?: string | null
    nl?: string | null
    tr?: string | null
  }>(),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedAt: updatedAt(),
})

/**
 * Instance-wide AI (OpenRouter) settings. A single row with id `default`.
 * Server-only: never include encryptedApiKey in UI DTOs.
 */
export const aiSettings = pgTable('ai_settings', {
  id: text('id').primaryKey(),
  encryptedApiKey: text('encrypted_api_key'),
  model: text('model'),
  /** Null means the built-in default prompt. */
  systemPrompt: text('system_prompt'),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedAt: updatedAt(),
})

/**
 * Instance-wide outgoing mail server. Singleton row `default`. When `enabled`
 * is false the environment SMTP settings are used instead.
 */
export const mailSettings = pgTable('mail_settings', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  host: text('host'),
  port: integer('port'),
  secure: text('secure').$type<MailSecure>(),
  username: text('username'),
  /** AES-256-GCM, context `mail-settings:smtp-password`. Never sent to the browser. */
  encryptedPassword: text('encrypted_password'),
  fromAddress: text('from_address'),
  replyTo: text('reply_to'),
  lastVerifiedAt: timestamptz('last_verified_at'),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedAt: updatedAt(),
})

/**
 * Transactional email waiting to be sent. Written in the same transaction as
 * the change that caused it, then delivered by the outbox loop with retries.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    /** Account email kind or notification event key, or 'test'. */
    kind: text('kind').notNull(),
    toAddress: text('to_address').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    notificationId: text('notification_id'),
    subject: text('subject').notNull(),
    template: text('template').notNull(),
    /** Secret values (tokens, links) are stored by reference, never here in plain text. */
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    locale: text('locale').notNull(),
    status: text('status')
      .$type<'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'>()
      .notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at'),
    leaseUntil: timestamptz('lease_until'),
    lastErrorCode: text('last_error_code'),
    lastErrorParams: jsonb('last_error_params').$type<Record<string, string>>(),
    /** Redacted technical detail, at most 500 characters. */
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamptz('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('email_outbox_status_next_attempt_idx').on(t.status, t.nextAttemptAt),
    index('email_outbox_created_at_idx').on(t.createdAt),
    // Claimable rows: queued and due, or sending with a lapsed lease.
    index('email_outbox_queued_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'queued'`),
    index('email_outbox_lease_expiry_idx')
      .on(t.leaseUntil)
      .where(sql`${t.status} = 'sending'`),
  ],
)

/**
 * One row per delivery attempt that reached an outcome. Test sends are not
 * recorded. The mail failure banner counts consecutive failed attempts here.
 * Deleted with their outbox row (30-day retention).
 */
export const emailDeliveryAttempt = pgTable(
  'email_delivery_attempt',
  {
    id: id(),
    outboxId: text('outbox_id')
      .notNull()
      .references(() => emailOutbox.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    outcome: text('outcome').$type<'sent' | 'retrying' | 'failed'>().notNull(),
    errorCode: text('error_code'),
    errorParams: jsonb('error_params').$type<Record<string, string>>(),
    createdAt: createdAt(),
  },
  (t) => [index('email_delivery_attempt_created_at_idx').on(t.createdAt)],
)

/**
 * Notification defaults and locks. `scope` agency rows have no organization;
 * agency rows also hold the agency-role ('agency') alerts.
 */
export const notificationRule = pgTable(
  'notification_rule',
  {
    id: id(),
    scope: text('scope').$type<'agency' | 'organization'>().notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    event: text('event').$type<EventKey>().notNull(),
    role: text('role').$type<NotificationRole>().notNull(),
    enabled: boolean('enabled').notNull(),
    locked: boolean('locked').notNull().default(false),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('notification_rule_scope_unique')
      .on(t.scope, t.organizationId, t.event, t.role)
      .nullsNotDistinct(),
  ],
)

/** A user's own choice. `organizationId` null holds agency-role choices. */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    event: text('event').$type<EventKey>().notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('notification_preference_unique')
      .on(t.userId, t.organizationId, t.event)
      .nullsNotDistinct(),
  ],
)

/** One row per recipient per event. Also the source for a future inbox. */
export const notification = pgTable(
  'notification',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    siteId: text('site_id').references(() => site.id, { onDelete: 'set null' }),
    event: text('event').$type<EventKey>().notNull(),
    payload: jsonb('payload').$type<NotificationPayload>().notNull(),
    /** `${event}:${subjectId}:${userId}`: one row per subject and recipient. */
    dedupeKey: text('dedupe_key'),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('notification_dedupe_key_unique').on(t.dedupeKey).nullsNotDistinct(),
    index('notification_user_id_idx').on(t.userId),
    index('notification_created_at_idx').on(t.createdAt),
  ],
)

/** Durable object cleanup survives row/org deletion and transient storage outages. */
export const storageObjectDeletion = pgTable(
  'storage_object_deletion',
  {
    storageKey: text('storage_key').primaryKey(),
    createdAt: createdAt(),
    lastError: text('last_error'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at'),
    /** Set when an operator dismisses a paused deletion. */
    dismissedAt: timestamptz('dismissed_at'),
  },
  (t) => [
    // The drain takes the oldest unpaused row. Ordering by created_at lets the
    // index supply the order; the due-time check runs on the few rows read.
    index('storage_deletion_unpaused_idx')
      .on(t.createdAt)
      .where(sql`${t.attempts} < 4`),
  ],
)

/** Cumulative operation counts survive job reconciliation and deletion. */
export const opsCounter = pgTable('ops_counter', {
  name: text('name').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
})

/**
 * Notifications owed for a state change: a release outcome or a failed
 * scheduled publish. Written in the same transaction as that change, then
 * delivered by a worker loop with retries. (kind, dedupe_key) is unique, so a
 * repeated write adds nothing. The dedupe key is the publication id for release
 * events, and the schedule subject for schedule events (no publication exists).
 */
export const notificationEvent = pgTable(
  'notification_event',
  {
    id: id(),
    kind: text('kind')
      .$type<'publication.live' | 'publication.failed' | 'schedule.failed'>()
      .notNull(),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    publicationId: text('publication_id').references(() => publication.id, {
      onDelete: 'cascade',
    }),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload')
      .$type<{
        stuck?: boolean
        previousPublicationId?: string | null
        scheduledBy?: string[]
        fingerprint?: string
      }>()
      .notNull()
      .default({}),
    status: text('status')
      .$type<'pending' | 'done' | 'failed'>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Due time while pending. While a loop holds the event, a lease time. */
    nextAttemptAt: timestamptz('next_attempt_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    processedAt: timestamptz('processed_at'),
  },
  (t) => [
    uniqueIndex('notification_event_kind_dedupe_unique').on(
      t.kind,
      t.dedupeKey,
    ),
    index('notification_event_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
)

/** Per-site scheduler retry cooldown. Survives process restart. */
export const schedulerBackoff = pgTable('scheduler_backoff', {
  siteId: text('site_id')
    .primaryKey()
    .references(() => site.id, { onDelete: 'cascade' }),
  lastAttemptAt: timestamptz('last_attempt_at').notNull(),
  lastError: text('last_error'),
  failureCount: integer('failure_count').notNull().default(0),
  approvalFingerprint: text('approval_fingerprint'),
  nextAttemptAt: timestamptz('next_attempt_at'),
  /** Set when an operator dismisses the paused schedule. */
  dismissedAt: timestamptz('dismissed_at'),
})

/** Which sites an MCP credential reaches: one site, or every site (agency admins). */
export type McpScope = 'site' | 'agency'

/**
 * Personal per-site API keys for the MCP server. Only the sha256 hash is
 * stored; `tokenPrefix` is the first characters of the token, for display.
 * The key acts as `userId` with that user's live role on the site.
 */
export const mcpKey = pgTable(
  'mcp_key',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 'site' keys act on one site; 'agency' keys act on every site (no site_id). */
    scope: text('scope').$type<McpScope>().notNull().default('site'),
    /** Null for agency scope. */
    siteId: text('site_id').references(() => site.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** Opt-in: lets an owner or agency admin key publish (go live). */
    allowGoLive: boolean('allow_go_live').notNull().default(false),
    expiresAt: timestamptz('expires_at'),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('mcp_key_site_id_idx').on(t.siteId),
    index('mcp_key_user_id_idx').on(t.userId),
    check(
      'mcp_key_scope_check',
      sql`${t.scope} in ('site', 'agency') and ((${t.scope} = 'site') = (${t.siteId} is not null))`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// OAuth 2.1 authorization server (@better-auth/oauth-provider). Model and field
// names must match the plugin's `schema` exactly; the drizzle adapter maps
// them by key. Access tokens are opaque (disableJwtPlugin), stored hashed.

export const oauthClient = pgTable(
  'oauthClient',
  {
    id: id(),
    clientId: text('clientId').notNull().unique(),
    clientSecret: text('clientSecret'),
    clientDiscoveryId: text('clientDiscoveryId'),
    disabled: boolean('disabled').notNull().default(false),
    skipConsent: boolean('skipConsent'),
    enableEndSession: boolean('enableEndSession'),
    subjectType: text('subjectType'),
    scopes: text('scopes').array(),
    clientCredentialsScopes: text('clientCredentialsScopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Set null, not cascade: deleting the person who registered an app must
    // not cut off other people's connections made through that app.
    userId: text('userId').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamptz('createdAt'),
    updatedAt: timestamptz('updatedAt'),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('softwareId'),
    softwareVersion: text('softwareVersion'),
    softwareStatement: text('softwareStatement'),
    redirectUris: text('redirectUris').array().notNull(),
    postLogoutRedirectUris: text('postLogoutRedirectUris').array(),
    backchannelLogoutUri: text('backchannelLogoutUri'),
    backchannelLogoutSessionRequired: boolean(
      'backchannelLogoutSessionRequired',
    ),
    tokenEndpointAuthMethod: text('tokenEndpointAuthMethod'),
    applicationType: text('applicationType'),
    jwks: text('jwks'),
    jwksUri: text('jwksUri'),
    grantTypes: text('grantTypes').array(),
    responseTypes: text('responseTypes').array(),
    requirePKCE: boolean('requirePKCE'),
    dpopBoundAccessTokens: boolean('dpopBoundAccessTokens')
      .notNull()
      .default(false),
    referenceId: text('referenceId'),
    metadata: jsonb('metadata'),
  },
  (t) => [index('oauth_client_user_id_idx').on(t.userId)],
)

export const oauthResource = pgTable('oauthResource', {
  id: id(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('accessTokenTtl'),
  refreshTokenTtl: integer('refreshTokenTtl'),
  signingAlgorithm: text('signingAlgorithm'),
  signingKeyId: text('signingKeyId'),
  allowedScopes: text('allowedScopes').array(),
  customClaims: jsonb('customClaims'),
  dpopBoundAccessTokensRequired: boolean('dpopBoundAccessTokensRequired')
    .notNull()
    .default(false),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamptz('createdAt'),
  updatedAt: timestamptz('updatedAt'),
  policyVersion: integer('policyVersion').notNull().default(1),
  metadata: jsonb('metadata'),
})

export const oauthClientResource = pgTable(
  'oauthClientResource',
  {
    id: id(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resourceId')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata'),
    createdAt: timestamptz('createdAt'),
  },
  (t) => [
    index('oauth_client_resource_client_idx').on(t.clientId),
    index('oauth_client_resource_resource_idx').on(t.resourceId),
    unique('oauth_client_resource_pair_unique').on(t.clientId, t.resourceId),
  ],
)

export const oauthRefreshToken = pgTable(
  'oauthRefreshToken',
  {
    id: id(),
    token: text('token').notNull().unique(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('sessionId').references(() => session.id, {
      onDelete: 'set null',
    }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('referenceId'),
    authorizationCodeId: text('authorizationCodeId'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requestedUserInfoClaims').array(),
    expiresAt: timestamptz('expiresAt').notNull(),
    createdAt: timestamptz('createdAt').notNull(),
    revoked: timestamptz('revoked'),
    rotatedAt: timestamptz('rotatedAt'),
    rotationReplayResponse: text('rotationReplayResponse'),
    rotationReplayExpiresAt: timestamptz('rotationReplayExpiresAt'),
    authTime: timestamptz('authTime'),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (t) => [
    index('oauth_refresh_token_client_idx').on(t.clientId),
    index('oauth_refresh_token_session_idx').on(t.sessionId),
    index('oauth_refresh_token_user_idx').on(t.userId),
    index('oauth_refresh_token_authorization_code_idx').on(
      t.authorizationCodeId,
    ),
  ],
)

export const oauthAccessToken = pgTable(
  'oauthAccessToken',
  {
    id: id(),
    token: text('token').unique(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('sessionId').references(() => session.id, {
      onDelete: 'set null',
    }),
    userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('referenceId'),
    authorizationCodeId: text('authorizationCodeId'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requestedUserInfoClaims').array(),
    refreshId: text('refreshId').references(() => oauthRefreshToken.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamptz('expiresAt').notNull(),
    createdAt: timestamptz('createdAt').notNull(),
    revoked: timestamptz('revoked'),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (t) => [
    index('oauth_access_token_client_idx').on(t.clientId),
    index('oauth_access_token_session_idx').on(t.sessionId),
    index('oauth_access_token_user_idx').on(t.userId),
    index('oauth_access_token_refresh_idx').on(t.refreshId),
    index('oauth_access_token_authorization_code_idx').on(
      t.authorizationCodeId,
    ),
  ],
)

export const oauthConsent = pgTable(
  'oauthConsent',
  {
    id: id(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('referenceId'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requestedUserInfoClaims').array(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamptz('createdAt'),
    updatedAt: timestamptz('updatedAt'),
  },
  (t) => [
    index('oauth_consent_client_idx').on(t.clientId),
    index('oauth_consent_user_idx').on(t.userId),
  ],
)

export const oauthClientAssertion = pgTable('oauthClientAssertion', {
  id: id(),
  expiresAt: timestamptz('expiresAt').notNull(),
})

/**
 * A user's connected AI app for one site (created when they approve the OAuth
 * consent screen). Active until revokedAt is set. The OAuth tokens themselves
 * live in the oauth tables and are matched to a connection by (user, client,
 * site resource) at request time.
 */
export const mcpConnection = pgTable(
  'mcp_connection',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 'site' connects one site; 'agency' connects every site (no site_id). */
    scope: text('scope').$type<McpScope>().notNull().default('site'),
    /** Null for agency scope. */
    siteId: text('site_id').references(() => site.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    clientName: text('client_name').notNull(),
    /** Opt-in: lets an owner or agency admin connection publish (go live). */
    allowGoLive: boolean('allow_go_live').notNull().default(false),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    index('mcp_connection_site_id_idx').on(t.siteId),
    index('mcp_connection_user_id_idx').on(t.userId),
    index('mcp_connection_client_id_idx').on(t.clientId),
    // One active connection per user, site and app; revoked rows are history.
    uniqueIndex('mcp_connection_active_unique')
      .on(t.userId, t.siteId, t.clientId)
      .where(sql`${t.revokedAt} is null`),
    // Agency connections have no site, so the index above cannot see them.
    uniqueIndex('mcp_connection_agency_active_unique')
      .on(t.userId, t.clientId)
      .where(sql`${t.revokedAt} is null and ${t.scope} = 'agency'`),
    check(
      'mcp_connection_scope_check',
      sql`${t.scope} in ('site', 'agency') and ((${t.scope} = 'site') = (${t.siteId} is not null))`,
    ),
  ],
)
