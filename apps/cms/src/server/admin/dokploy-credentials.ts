import { eq } from 'drizzle-orm'

import {
  createDokployAdapter,
  listDokployApplications,
} from '#/adapters/deployment/dokploy'
import type { DokployApplicationSummary } from '#/adapters/deployment/dokploy'
import { db } from '#/db'
import { dokployCredential, organization } from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { assertSecureServiceUrl } from '#/server/http/outbound-url'
import {
  decryptSecret,
  encryptSecret,
} from '#/server/security/secret-encryption'

type FetchFn = typeof fetch

const encryptionContext = (organizationId: string) =>
  `dokploy-credential:${organizationId}`

function connectionOptions(url: string, apiKey: string, fetch?: FetchFn) {
  return {
    baseUrl: url,
    apiKey,
    fetch,
    allowInsecureHttp: env.DOKPLOY_ALLOW_INSECURE_HTTP === 'true',
  }
}

function normalizeUrl(url: string) {
  return assertSecureServiceUrl(
    url.trim(),
    env.DOKPLOY_ALLOW_INSECURE_HTTP === 'true',
  ).href.replace(/\/$/, '')
}

async function requireOrganization(organizationId: string) {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  const row = rows.at(0)
  if (!row) throw new NotFoundError(m.server_organization_not_found())
}

async function getStoredCredential(organizationId: string) {
  const rows = await db
    .select()
    .from(dokployCredential)
    .where(eq(dokployCredential.organizationId, organizationId))
    .limit(1)
  return rows.at(0) ?? null
}

function decryptApiKey(row: typeof dokployCredential.$inferSelect) {
  return decryptSecret(
    row.encryptedApiKey,
    env.DOKPLOY_CREDENTIALS_ENCRYPTION_KEY,
    encryptionContext(row.organizationId),
  )
}

export async function getDokployCredentialStatus(organizationId: string) {
  await requireOrganization(organizationId)
  const row = await getStoredCredential(organizationId)
  return {
    configured: Boolean(row),
    url: row?.url ?? null,
  }
}

export async function saveDokployCredentials(input: {
  organizationId: string
  url: string
  apiKey?: string
  actorId: string
  fetch?: FetchFn
}) {
  await requireOrganization(input.organizationId)
  const existing = await getStoredCredential(input.organizationId)
  const url = normalizeUrl(input.url)
  const enteredApiKey = input.apiKey?.trim()
  if (!existing && !enteredApiKey) {
    throw new ValidationError([
      { path: 'apiKey', message: 'A Dokploy API key is required' },
    ])
  }
  const apiKey = enteredApiKey || (existing ? decryptApiKey(existing) : '')

  let verification: Awaited<ReturnType<typeof listDokployApplications>>
  try {
    verification = await listDokployApplications(
      connectionOptions(url, apiKey, input.fetch),
    )
  } catch (error) {
    await audit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'organization.dokploy_credentials_validation_failed',
      targetType: 'organization',
      targetId: input.organizationId,
    })
    throw error
  }

  let encryptedApiKey: string
  if (enteredApiKey) {
    encryptedApiKey = encryptSecret(
      enteredApiKey,
      env.DOKPLOY_CREDENTIALS_ENCRYPTION_KEY,
      encryptionContext(input.organizationId),
    )
  } else if (existing) {
    encryptedApiKey = existing.encryptedApiKey
  } else {
    throw new ValidationError([
      { path: 'apiKey', message: 'A Dokploy API key is required' },
    ])
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(dokployCredential)
      .values({
        organizationId: input.organizationId,
        url,
        encryptedApiKey,
      })
      .onConflictDoUpdate({
        target: dokployCredential.organizationId,
        set: { url, encryptedApiKey, updatedAt: new Date() },
      })

    await audit(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: existing
          ? 'organization.dokploy_credentials_updated'
          : 'organization.dokploy_credentials_created',
        targetType: 'organization',
        targetId: input.organizationId,
        meta: { apiKeyReplaced: Boolean(enteredApiKey) },
      },
      tx,
    )
  })

  return {
    configured: true as const,
    url,
    ...verification,
  }
}

export async function verifyDokployCredentials(input: {
  organizationId: string
  actorId: string
  fetch?: FetchFn
}) {
  await requireOrganization(input.organizationId)
  const row = await getStoredCredential(input.organizationId)
  if (!row) throw new ConflictError('Dokploy credentials are not configured')

  try {
    const result = await listDokployApplications(
      connectionOptions(row.url, decryptApiKey(row), input.fetch),
    )
    await audit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'organization.dokploy_credentials_verified',
      targetType: 'organization',
      targetId: input.organizationId,
      meta: { applicationCount: result.total },
    })
    return result
  } catch (error) {
    await audit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'organization.dokploy_credentials_validation_failed',
      targetType: 'organization',
      targetId: input.organizationId,
    })
    throw error
  }
}

export async function removeDokployCredentials(input: {
  organizationId: string
  actorId: string
}) {
  await requireOrganization(input.organizationId)
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(dokployCredential)
      .where(eq(dokployCredential.organizationId, input.organizationId))
      .returning({ organizationId: dokployCredential.organizationId })
    if (removed.length === 0) {
      throw new ConflictError('Dokploy credentials are not configured')
    }
    await audit(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'organization.dokploy_credentials_removed',
        targetType: 'organization',
        targetId: input.organizationId,
      },
      tx,
    )
  })
  return { ok: true as const }
}

export async function getDeploymentAdapterForOrganization(
  organizationId: string,
) {
  const row = await getStoredCredential(organizationId)
  if (row) {
    return createDokployAdapter({
      ...connectionOptions(row.url, decryptApiKey(row)),
      allowPrivateHealthChecks: env.ALLOW_PRIVATE_HEALTH_CHECKS === 'true',
    })
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    env.DOKPLOY_DEV_FALLBACK_ENABLED &&
    env.DOKPLOY_URL &&
    env.DOKPLOY_API_KEY
  ) {
    return createDokployAdapter({
      ...connectionOptions(env.DOKPLOY_URL, env.DOKPLOY_API_KEY),
      allowPrivateHealthChecks: env.ALLOW_PRIVATE_HEALTH_CHECKS === 'true',
    })
  }

  throw new ConflictError(
    'Dokploy credentials are not configured for this organization',
  )
}

export type { DokployApplicationSummary }
