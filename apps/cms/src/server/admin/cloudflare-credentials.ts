import { and, eq, sql } from 'drizzle-orm'

import {
  cloudflareChecksPassed,
  createCloudflareClient,
  isValidCloudflareAccountId,
} from '#/adapters/deployment/cloudflare-api'
import type {
  CloudflareClient,
  CloudflarePermissionChecks,
  CloudflareTokenCheck,
} from '#/adapters/deployment/cloudflare-api'
import { db } from '#/db'
import { cloudflareCredential, organization, site, user } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from './organization-lock'
import { assertOrganizationHasNoPendingDeployment } from '#/server/publishing/deployment-safety'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import {
  decryptSecret,
  encryptSecret,
} from '#/server/security/secret-encryption'

type FetchFn = typeof fetch

const encryptionContext = (organizationId: string) =>
  `cloudflare-credential:${organizationId}`

/** Test stub only: honoured outside production, see the e2e Cloudflare stub. */
function baseUrlOverride() {
  return process.env.NODE_ENV !== 'production'
    ? env.CLOUDFLARE_API_BASE_URL
    : undefined
}

function encryptionKey() {
  const key = env.CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY
  if (!key) {
    throw new ConflictError(
      'CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY is not set on the server, so Cloudflare credentials cannot be saved or read',
    )
  }
  return key
}

function clientFor(input: {
  apiToken: string
  accountId: string
  fetch?: FetchFn
}): CloudflareClient {
  return createCloudflareClient({
    apiToken: input.apiToken,
    accountId: input.accountId,
    fetch: input.fetch,
    baseUrl: baseUrlOverride(),
  })
}

async function requireOrganization(organizationId: string) {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!rows.at(0)) throw new NotFoundError(m.server_organization_not_found())
}

async function getStoredCredential(organizationId: string) {
  const rows = await db
    .select()
    .from(cloudflareCredential)
    .where(eq(cloudflareCredential.organizationId, organizationId))
    .limit(1)
  return rows.at(0) ?? null
}

function decryptApiToken(row: typeof cloudflareCredential.$inferSelect) {
  return decryptSecret(
    row.encryptedApiToken,
    encryptionKey(),
    encryptionContext(row.organizationId),
  )
}

function tokenRefusal(token: CloudflareTokenCheck) {
  switch (token.status) {
    case 'disabled':
      return 'The token is disabled in Cloudflare'
    case 'expired':
      return 'The token has expired'
    default:
      return token.message ?? 'Cloudflare did not accept the token'
  }
}

/**
 * What the admin UI may show about the connection. Never the token or its
 * ciphertext: the DTO is built field by field.
 */
export type CloudflareCredentialStatus = {
  encryptionAvailable: boolean
  configured: boolean
  accountId: string | null
  tokenLast4: string | null
  updatedAt: Date | null
  updatedByName: string | null
  lastVerifiedAt: Date | null
  lastVerifyResult: CloudflarePermissionChecks | null
  sitesUsingCloudflare: number
}

async function readStatus(
  organizationId: string,
): Promise<CloudflareCredentialStatus> {
  const row = (
    await db
      .select({
        credential: cloudflareCredential,
        updatedByName: user.name,
      })
      .from(cloudflareCredential)
      .leftJoin(user, eq(user.id, cloudflareCredential.updatedBy))
      .where(eq(cloudflareCredential.organizationId, organizationId))
      .limit(1)
  ).at(0)
  const counted = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(site)
      .where(
        and(
          eq(site.organizationId, organizationId),
          sql`${site.deploymentTarget}->>'provider' = 'cloudflare'`,
        ),
      )
  ).at(0)

  const credential = row?.credential
  return {
    encryptionAvailable: Boolean(env.CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY),
    configured: Boolean(credential),
    accountId: credential?.accountId ?? null,
    tokenLast4: credential?.tokenLast4 ?? null,
    updatedAt: credential?.updatedAt ?? null,
    updatedByName: row?.updatedByName ?? null,
    lastVerifiedAt: credential?.lastVerifiedAt ?? null,
    lastVerifyResult:
      (credential?.lastVerifyResult as CloudflarePermissionChecks | null) ??
      null,
    sitesUsingCloudflare: counted?.count ?? 0,
  }
}

export async function getCloudflareCredentialStatus(organizationId: string) {
  await requireOrganization(organizationId)
  return readStatus(organizationId)
}

export async function saveCloudflareCredentials(input: {
  organizationId: string
  accountId: string
  apiToken?: string
  actorId: string
  fetch?: FetchFn
}) {
  await requireOrganization(input.organizationId)
  const key = encryptionKey()
  if (!isValidCloudflareAccountId(input.accountId)) {
    throw new ValidationError([
      {
        path: 'accountId',
        message: 'Use the 32-character Cloudflare account ID',
      },
    ])
  }
  const accountId = input.accountId.toLowerCase()
  const existing = await getStoredCredential(input.organizationId)
  const enteredToken = input.apiToken?.trim() || undefined

  let apiToken: string
  if (enteredToken) {
    apiToken = enteredToken
  } else if (existing) {
    apiToken = decryptApiToken(existing)
  } else {
    throw new ValidationError([
      { path: 'apiToken', message: 'A Cloudflare API token is required' },
    ])
  }

  const checks = await clientFor({
    apiToken,
    accountId,
    fetch: input.fetch,
  }).checkPermissions()
  if (!checks.token.ok) {
    await audit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'organization.cloudflare_credentials_validation_failed',
      targetType: 'organization',
      targetId: input.organizationId,
      meta: { tokenStatus: checks.token.status },
    })
    throw new ValidationError([
      { path: 'apiToken', message: tokenRefusal(checks.token) },
    ])
  }

  const now = new Date()
  const encryptedApiToken = enteredToken
    ? encryptSecret(enteredToken, key, encryptionContext(input.organizationId))
    : existing?.encryptedApiToken
  if (!encryptedApiToken) {
    throw new ConflictError(
      'Cloudflare credentials changed; reload before saving',
    )
  }
  const tokenLast4 = enteredToken
    ? enteredToken.slice(-4)
    : (existing?.tokenLast4 ?? '')
  const passed = cloudflareChecksPassed(checks)

  await db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, input.organizationId)
    const current = (
      await tx
        .select()
        .from(cloudflareCredential)
        .where(eq(cloudflareCredential.organizationId, input.organizationId))
    ).at(0)
    if (!current || current.accountId !== accountId)
      await assertOrganizationHasNoPendingDeployment(
        tx,
        input.organizationId,
        'the Cloudflare connection',
      )
    // A concurrent token change must not be overwritten by a reused token.
    if (
      !enteredToken &&
      current?.encryptedApiToken !== existing?.encryptedApiToken
    )
      throw new ConflictError(
        'Cloudflare credentials changed; reload before saving',
      )

    const values = {
      accountId,
      encryptedApiToken,
      tokenLast4,
      lastVerifiedAt: now,
      lastVerifyResult: checks,
      updatedBy: input.actorId,
      updatedAt: now,
    }
    await tx
      .insert(cloudflareCredential)
      .values({ organizationId: input.organizationId, ...values })
      .onConflictDoUpdate({
        target: cloudflareCredential.organizationId,
        set: values,
      })

    await audit(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: existing
          ? 'organization.cloudflare_credentials_updated'
          : 'organization.cloudflare_credentials_created',
        targetType: 'organization',
        targetId: input.organizationId,
        meta: { tokenReplaced: Boolean(enteredToken), checksPassed: passed },
      },
      tx,
    )
  })

  return { ...(await readStatus(input.organizationId)), checks }
}

export async function verifyCloudflareCredentials(input: {
  organizationId: string
  actorId: string
  fetch?: FetchFn
}) {
  await requireOrganization(input.organizationId)
  const row = await getStoredCredential(input.organizationId)
  if (!row) throw new ConflictError('Cloudflare credentials are not configured')

  const checks = await clientFor({
    apiToken: decryptApiToken(row),
    accountId: row.accountId,
    fetch: input.fetch,
  }).checkPermissions()
  const passed = cloudflareChecksPassed(checks)

  await db
    .update(cloudflareCredential)
    .set({ lastVerifiedAt: new Date(), lastVerifyResult: checks })
    .where(eq(cloudflareCredential.organizationId, input.organizationId))
  await audit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: passed
      ? 'organization.cloudflare_credentials_verified'
      : 'organization.cloudflare_credentials_validation_failed',
    targetType: 'organization',
    targetId: input.organizationId,
    meta: { checksPassed: passed },
  })

  return { ...(await readStatus(input.organizationId)), checks }
}

export async function removeCloudflareCredentials(input: {
  organizationId: string
  actorId: string
}) {
  await requireOrganization(input.organizationId)
  await db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, input.organizationId)
    await assertOrganizationHasNoPendingDeployment(
      tx,
      input.organizationId,
      'the Cloudflare connection',
    )
    const removed = await tx
      .delete(cloudflareCredential)
      .where(eq(cloudflareCredential.organizationId, input.organizationId))
      .returning({ organizationId: cloudflareCredential.organizationId })
    if (removed.length === 0) {
      throw new ConflictError('Cloudflare credentials are not configured')
    }
    await audit(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'organization.cloudflare_credentials_removed',
        targetType: 'organization',
        targetId: input.organizationId,
      },
      tx,
    )
  })
  return { ok: true as const }
}

/**
 * The Cloudflare client for a client's stored credentials. PR 2 uses it to
 * deploy; nothing calls it yet.
 */
export async function getCloudflareClientForOrganization(
  organizationId: string,
  options: { fetch?: FetchFn } = {},
): Promise<CloudflareClient> {
  const row = await getStoredCredential(organizationId)
  if (!row) {
    throw new ConflictError(
      'Cloudflare credentials are not configured for this client',
    )
  }
  return clientFor({
    apiToken: decryptApiToken(row),
    accountId: row.accountId,
    fetch: options.fetch,
  })
}
