import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, dokployCredential, organization, user } from '#/db/schema'

import {
  getDokployCredentialStatus,
  removeDokployCredentials,
  saveDokployCredentials,
  verifyDokployCredentials,
} from './dokploy-credentials'
import { createOrganization } from './organizations'

const hasDb = Boolean(process.env.DATABASE_URL)

function applicationResponse(applicationId = 'app-1') {
  return new Response(
    JSON.stringify({
      items: [
        {
          applicationId,
          name: 'Customer site',
          appName: 'customer-site',
          applicationStatus: 'done',
        },
      ],
      total: 1,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe.skipIf(!hasDb)('organization Dokploy credentials', () => {
  it('stores only ciphertext, retains or replaces the key, verifies, audits, and removes', async () => {
    const suffix = crypto.randomUUID()
    const actor = (
      await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: 'Dokploy Admin',
          email: `dokploy-admin-${suffix}@test.local`,
          emailVerified: true,
        })
        .returning()
    ).at(0)
    if (!actor) throw new Error('Failed to create actor')
    const org = await createOrganization({
      name: `Dokploy Org ${suffix}`,
      slug: `dokploy-org-${suffix}`,
      actorId: actor.id,
    })
    const seenKeys: string[] = []
    const fakeFetch: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      seenKeys.push(headers.get('x-api-key') ?? '')
      return applicationResponse()
    }

    try {
      expect(await getDokployCredentialStatus(org.id)).toEqual({
        configured: false,
        url: null,
      })

      const created = await saveDokployCredentials({
        organizationId: org.id,
        url: 'https://dokploy-one.example.com/',
        apiKey: 'first-secret-key',
        actorId: actor.id,
        fetch: fakeFetch,
      })
      expect(created).toMatchObject({
        configured: true,
        url: 'https://dokploy-one.example.com',
        total: 1,
      })
      expect(created).not.toHaveProperty('apiKey')

      const storedFirst = (
        await db
          .select()
          .from(dokployCredential)
          .where(eq(dokployCredential.organizationId, org.id))
      ).at(0)
      expect(storedFirst?.encryptedApiKey).not.toContain('first-secret-key')

      await saveDokployCredentials({
        organizationId: org.id,
        url: 'https://dokploy-two.example.com',
        actorId: actor.id,
        fetch: fakeFetch,
      })
      const storedUrlUpdate = (
        await db
          .select()
          .from(dokployCredential)
          .where(eq(dokployCredential.organizationId, org.id))
      ).at(0)
      expect(storedUrlUpdate?.encryptedApiKey).toBe(
        storedFirst?.encryptedApiKey,
      )

      await saveDokployCredentials({
        organizationId: org.id,
        url: 'https://dokploy-two.example.com',
        apiKey: 'replacement-secret-key',
        actorId: actor.id,
        fetch: fakeFetch,
      })
      const storedReplacement = (
        await db
          .select()
          .from(dokployCredential)
          .where(eq(dokployCredential.organizationId, org.id))
      ).at(0)
      expect(storedReplacement?.encryptedApiKey).not.toBe(
        storedFirst?.encryptedApiKey,
      )
      expect(storedReplacement?.encryptedApiKey).not.toContain(
        'replacement-secret-key',
      )

      const verified = await verifyDokployCredentials({
        organizationId: org.id,
        actorId: actor.id,
        fetch: fakeFetch,
      })
      expect(verified.applications[0]?.applicationId).toBe('app-1')
      expect(seenKeys).toEqual([
        'first-secret-key',
        'first-secret-key',
        'replacement-secret-key',
        'replacement-secret-key',
      ])

      await removeDokployCredentials({
        organizationId: org.id,
        actorId: actor.id,
      })
      expect(await getDokployCredentialStatus(org.id)).toEqual({
        configured: false,
        url: null,
      })

      const actions = await db
        .select({ action: auditLog.action, meta: auditLog.meta })
        .from(auditLog)
        .where(eq(auditLog.organizationId, org.id))
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'organization.dokploy_credentials_created',
          'organization.dokploy_credentials_updated',
          'organization.dokploy_credentials_verified',
          'organization.dokploy_credentials_removed',
        ]),
      )
      expect(JSON.stringify(actions)).not.toContain('secret-key')
    } finally {
      await db.delete(organization).where(eq(organization.id, org.id))
      await db.delete(user).where(eq(user.id, actor.id))
    }
  })

  it('does not store credentials when verification fails', async () => {
    const suffix = crypto.randomUUID()
    const actor = (
      await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: 'Dokploy Failure Admin',
          email: `dokploy-failure-${suffix}@test.local`,
          emailVerified: true,
        })
        .returning()
    ).at(0)
    if (!actor) throw new Error('Failed to create actor')
    const org = await createOrganization({
      name: `Dokploy Failure Org ${suffix}`,
      slug: `dokploy-failure-org-${suffix}`,
      actorId: actor.id,
    })

    try {
      await expect(
        saveDokployCredentials({
          organizationId: org.id,
          url: 'https://dokploy.example.com',
          apiKey: 'invalid-secret-key',
          actorId: actor.id,
          fetch: async () => new Response('', { status: 401 }),
        }),
      ).rejects.toThrow(/failed: 401/)

      expect(await getDokployCredentialStatus(org.id)).toEqual({
        configured: false,
        url: null,
      })
      const actions = await db
        .select({ action: auditLog.action, meta: auditLog.meta })
        .from(auditLog)
        .where(eq(auditLog.organizationId, org.id))
      expect(actions.map((row) => row.action)).toContain(
        'organization.dokploy_credentials_validation_failed',
      )
      expect(JSON.stringify(actions)).not.toContain('invalid-secret-key')
    } finally {
      await db.delete(organization).where(eq(organization.id, org.id))
      await db.delete(user).where(eq(user.id, actor.id))
    }
  })
})
