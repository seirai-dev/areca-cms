import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
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
    issuer: text('issuer').notNull(),
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
  (t) => [
    index('account_user_id_idx').on(t.userId),
    unique('account_issuer_account_id_unique').on(t.issuer, t.accountId),
  ],
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

export const organization = pgTable('organization', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
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
  productionUrl: text('production_url').notNull(),
  previewSecret: text('preview_secret').notNull(),
  deploymentTarget: jsonb('deployment_target').$type<DeploymentTarget | null>(),
  lastManifest: jsonb('last_manifest').$type<SiteManifest | null>(),
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
    scheduledAt: timestamptz('scheduled_at'),
    scheduleTimezone: text('schedule_timezone'),
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
    requestedBy: text('requested_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<PublicationStatus>().notNull(),
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
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    logs: text('logs'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('build_job_status_idx').on(t.status)],
)

export const auditLog = pgTable('audit_log', {
  id: id(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
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
  font: text('font'),
  emailFromName: text('email_from_name'),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedAt: updatedAt(),
})
