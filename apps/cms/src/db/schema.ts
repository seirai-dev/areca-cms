import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import type {
  AuditMeta,
  BuildJobStatus,
  DeploymentTarget,
  EntryData,
  EntryStatus,
  Field,
  MembershipRole,
  PublicationStatus,
  SiteManifest,
  Snapshot,
} from '../lib/types.ts'
import type { AdvancedBrandColors } from '../lib/branding.ts'

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
  token: text('token').notNull().unique(),
  expiresAt: timestamptz('expires_at').notNull(),
  acceptedAt: timestamptz('accepted_at'),
  /** 'sent' once the email was handed to SMTP; 'failed' keeps the row for resend. */
  deliveryStatus: text('delivery_status')
    .$type<'sent' | 'failed'>()
    .notNull()
    .default('sent'),
  lastDeliveryError: text('last_delivery_error'),
  lastSentAt: timestamptz('last_sent_at'),
  createdAt: createdAt(),
})

export const site = pgTable('site', {
  id: id(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  schemaTokenHash: text('schema_token_hash').unique(),
  productionUrl: text('production_url').notNull(),
  previewSecret: text('preview_secret').notNull(),
  publishingMode: text('publishing_mode')
    .$type<'production' | 'demo'>()
    .notNull()
    .default('production'),
  deploymentTarget: jsonb('deployment_target').$type<DeploymentTarget | null>(),
  lastManifest: jsonb('last_manifest').$type<SiteManifest | null>(),
  /** Extra instructions appended to the AI SEO system prompt for this site. */
  aiPrompt: text('ai_prompt'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

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
  ],
)

export const entryRevision = pgTable('entry_revision', {
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
})

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

export const asset = pgTable('asset', {
  id: id(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  altText: text('alt_text'),
  createdBy: text('created_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
})

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
    createdAt: createdAt(),
    deployedAt: timestamptz('deployed_at'),
  },
  (t) => [index('publication_site_id_idx').on(t.siteId)],
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
  jobId: text('job_id')
    .notNull()
    .references(() => buildJob.id, { onDelete: 'cascade' }),
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

/** Durable object cleanup survives row/org deletion and transient storage outages. */
export const storageObjectDeletion = pgTable('storage_object_deletion', {
  storageKey: text('storage_key').primaryKey(),
  createdAt: createdAt(),
  lastError: text('last_error'),
})

/** Per-site scheduler retry cooldown. Survives process restart. */
export const schedulerBackoff = pgTable('scheduler_backoff', {
  siteId: text('site_id')
    .primaryKey()
    .references(() => site.id, { onDelete: 'cascade' }),
  lastAttemptAt: timestamptz('last_attempt_at').notNull(),
  lastError: text('last_error'),
})
