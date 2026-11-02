/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays and fake responses are checked defensively in tests. */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import {
  auditLog,
  buildJob,
  cloudflareCredential,
  organization,
  site,
  user,
} from '#/db/schema'
import { env } from '#/env'
import { ConflictError, ValidationError } from '#/server/content/errors'
import { decryptSecret } from '#/server/security/secret-encryption'

import { cloudflareChecksPassed } from '#/adapters/deployment/cloudflare-api'

import {
  getCloudflareCredentialStatus,
  getCloudflareClientForOrganization,
  removeCloudflareCredentials,
  saveCloudflareCredentials,
  verifyCloudflareCredentials,
} from './cloudflare-credentials'
import { createOrganization } from './organizations'
import { createTestSite } from '#/server/content/test-utils'
import { insertPublication } from '#/server/notifications/test-utils'
import { createSite } from './sites'

const hasDb = Boolean(process.env.DATABASE_URL)
const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const OTHER_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210'

type Behaviour = {
  tokenStatus?: 'active' | 'disabled' | 'expired'
  pagesOk?: boolean
}

/**
 * Answers the Cloudflare endpoints the credential module calls. Records the
 * bearer token and account of every request so tests can assert what was used.
 */
function fakeCloudflare(behaviour: Behaviour = {}) {
  const authorizations: string[] = []
  const accounts: string[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    authorizations.push(new Headers(init?.headers).get('authorization') ?? '')
    const account = /^\/client\/v4\/accounts\/([^/]+)\//.exec(url.pathname)
    if (account) accounts.push(account[1] ?? '')
    const envelope = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.pathname.endsWith('/user/tokens/verify')) {
      const status = behaviour.tokenStatus ?? 'active'
      return status === 'active'
        ? envelope(200, { success: true, errors: [], result: { status } })
        : envelope(200, { success: true, errors: [], result: { status } })
    }
    if (url.pathname.endsWith('/pages/projects')) {
      return behaviour.pagesOk === false
        ? envelope(403, {
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
          })
        : envelope(200, { success: true, errors: [], result: [] })
    }
    if (url.pathname.endsWith('/workers/scripts')) {
      return envelope(200, { success: true, errors: [], result: [] })
    }
    return envelope(404, { success: false, errors: [{ message: 'no route' }] })
  }
  return { fetchFn, authorizations, accounts }
}

async function createActor(label: string) {
  const suffix = crypto.randomUUID()
  const actor = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: `Cloudflare ${label}`,
        email: `cloudflare-${label}-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
  ).at(0)
  if (!actor) throw new Error('Failed to create actor')
  const org = await createOrganization({
    name: `Cloudflare ${label} ${suffix}`,
    slug: `cloudflare-${label}-${suffix}`,
    actorId: actor.id,
  })
  return { actor, org }
}

async function cleanup(orgId: string, userId: string) {
  await db.delete(organization).where(eq(organization.id, orgId))
  await db.delete(user).where(eq(user.id, userId))
}

async function actionsFor(orgId: string) {
  return db
    .select({ action: auditLog.action, meta: auditLog.meta })
    .from(auditLog)
    .where(eq(auditLog.organizationId, orgId))
}

describe('cloudflareChecksPassed', () => {
  const passing = {
    token: { ok: true, status: 'active' as const },
    pages: { ok: true, count: 1 },
    workersScripts: { ok: true, count: 0 },
    workersCi: { ok: false, skipped: 'no-workers' as const },
  }

  it('accepts a missing Workers CI check only when the account has no Workers', () => {
    expect(cloudflareChecksPassed(passing)).toBe(true)
    expect(
      cloudflareChecksPassed({
        ...passing,
        workersCi: { ok: false, message: 'forbidden' },
      }),
    ).toBe(false)
    expect(
      cloudflareChecksPassed({
        ...passing,
        pages: { ok: false, message: 'forbidden' },
      }),
    ).toBe(false)
  })
})

describe.skipIf(!hasDb)('organization Cloudflare credentials', () => {
  it('requires a token on the first save and refuses inactive tokens with an audit row', async () => {
    const { actor, org } = await createActor('refuse')
    try {
      await expect(
        saveCloudflareCredentials({
          organizationId: org.id,
          accountId: ACCOUNT_ID,
          actorId: actor.id,
          fetch: fakeCloudflare().fetchFn,
        }),
      ).rejects.toMatchObject({ errors: [{ path: 'apiToken' }] })

      for (const tokenStatus of ['disabled', 'expired'] as const) {
        const error = await saveCloudflareCredentials({
          organizationId: org.id,
          accountId: ACCOUNT_ID,
          apiToken: `cfut_${tokenStatus}_secret_0001`,
          actorId: actor.id,
          fetch: fakeCloudflare({ tokenStatus }).fetchFn,
        }).catch((err: unknown) => err)
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).errors[0]).toMatchObject({
          path: 'apiToken',
        })
      }

      expect(await getCloudflareCredentialStatus(org.id)).toMatchObject({
        configured: false,
        accountId: null,
      })
      const actions = await actionsFor(org.id)
      expect(
        actions.filter(
          (row) =>
            row.action ===
            'organization.cloudflare_credentials_validation_failed',
        ),
      ).toHaveLength(2)
      expect(JSON.stringify(actions)).not.toContain('_secret_')
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('stores only ciphertext, returns the last four characters, and decrypts with the org context', async () => {
    const { actor, org } = await createActor('store')
    const token = 'cfut_first_secret_9999'
    try {
      const saved = await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: token,
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      expect(saved).toMatchObject({
        configured: true,
        accountId: ACCOUNT_ID,
        tokenLast4: '9999',
        updatedByName: actor.name,
        encryptionAvailable: true,
      })
      expect(saved.checks.token).toEqual({ ok: true, status: 'active' })
      expect(JSON.stringify(saved)).not.toContain(token)

      const status = await getCloudflareCredentialStatus(org.id)
      expect(JSON.stringify(status)).not.toContain(token)
      expect(JSON.stringify(status)).not.toContain('encrypted')
      expect(status).not.toHaveProperty('apiToken')
      expect(status.lastVerifyResult?.token.ok).toBe(true)

      const row = (
        await db
          .select()
          .from(cloudflareCredential)
          .where(eq(cloudflareCredential.organizationId, org.id))
      ).at(0)
      expect(row?.encryptedApiToken).not.toContain(token)
      expect(row?.encryptedApiToken).not.toContain('secret')
      expect(
        decryptSecret(
          row?.encryptedApiToken ?? '',
          env.CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY ?? '',
          `cloudflare-credential:${org.id}`,
        ),
      ).toBe(token)
      expect(() =>
        decryptSecret(
          row?.encryptedApiToken ?? '',
          env.CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY ?? '',
          'cloudflare-credential:some-other-org',
        ),
      ).toThrow(/could not be decrypted/)
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('reuses the stored token when only the account ID changes', async () => {
    const { actor, org } = await createActor('reuse')
    const token = 'cfut_reuse_secret_4321'
    try {
      await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: token,
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      const fake = fakeCloudflare()
      const saved = await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: OTHER_ACCOUNT_ID,
        actorId: actor.id,
        fetch: fake.fetchFn,
      })
      expect(saved.accountId).toBe(OTHER_ACCOUNT_ID)
      expect(saved.tokenLast4).toBe('4321')
      expect(
        fake.authorizations.every((value) => value === `Bearer ${token}`),
      ).toBe(true)
      expect(fake.accounts.every((value) => value === OTHER_ACCOUNT_ID)).toBe(
        true,
      )

      const client = await getCloudflareClientForOrganization(org.id, {
        fetch: fakeCloudflare().fetchFn,
      })
      await expect(client.verifyToken()).resolves.toEqual({ status: 'active' })
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('saves with failing permissions, reports them, and verify stores the last result', async () => {
    const { actor, org } = await createActor('partial')
    try {
      const saved = await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_partial_secret_5555',
        actorId: actor.id,
        fetch: fakeCloudflare({ pagesOk: false }).fetchFn,
      })
      expect(saved.configured).toBe(true)
      expect(saved.checks.pages).toMatchObject({
        ok: false,
        message: expect.stringContaining('Authentication error'),
      })

      const stillFailing = await verifyCloudflareCredentials({
        organizationId: org.id,
        actorId: actor.id,
        fetch: fakeCloudflare({ pagesOk: false }).fetchFn,
      })
      expect(cloudflareChecksPassed(stillFailing.checks)).toBe(false)

      const verified = await verifyCloudflareCredentials({
        organizationId: org.id,
        actorId: actor.id,
        fetch: fakeCloudflare({ pagesOk: true }).fetchFn,
      })
      expect(verified.checks.pages.ok).toBe(true)
      expect(verified.lastVerifiedAt).toBeInstanceOf(Date)
      expect(verified.lastVerifyResult?.pages.ok).toBe(true)

      const actions = (await actionsFor(org.id)).map((row) => row.action)
      expect(actions).toEqual(
        expect.arrayContaining([
          'organization.cloudflare_credentials_created',
          'organization.cloudflare_credentials_validation_failed',
          'organization.cloudflare_credentials_verified',
        ]),
      )
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('verify on a fully passing connection audits verified', async () => {
    const { actor, org } = await createActor('verified')
    try {
      await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_all_pass_secret_6666',
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      const verified = await verifyCloudflareCredentials({
        organizationId: org.id,
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      expect(cloudflareChecksPassed(verified.checks)).toBe(true)
      expect((await actionsFor(org.id)).map((row) => row.action)).toContain(
        'organization.cloudflare_credentials_verified',
      )
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('counts the sites that deploy with Cloudflare', async () => {
    const { actor, org } = await createActor('sites')
    try {
      await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_sites_secret_7777',
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      expect(
        (await getCloudflareCredentialStatus(org.id)).sitesUsingCloudflare,
      ).toBe(0)
      const created = await createSite({
        organizationId: org.id,
        name: 'Cloudflare site',
        slug: `cf-site-${crypto.randomUUID().slice(0, 8)}`,
        productionUrl: 'https://cloudflare-site.example.com',
        actorId: actor.id,
      })
      await db
        .update(site)
        .set({
          deploymentTarget: {
            provider: 'cloudflare',
            kind: 'pages',
            projectName: 'northbound',
            branch: 'main',
            healthCheckUrl: 'https://northbound.example.com/health',
          } as unknown as typeof site.$inferSelect.deploymentTarget,
        })
        .where(eq(site.id, created.id))
      expect(
        (await getCloudflareCredentialStatus(org.id)).sitesUsingCloudflare,
      ).toBe(1)
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('keeps the account and blocks removal while a release is pending', async () => {
    const { org, actor, site: pendingSite } = await createTestSite()
    const fake = fakeCloudflare()
    try {
      await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_pending_secret_1000',
        actorId: actor.id,
        fetch: fake.fetchFn,
      })
      const publication = await insertPublication({ siteId: pendingSite.id })
      await db.insert(buildJob).values({
        siteId: pendingSite.id,
        publicationId: publication.id,
        status: 'queued',
      })

      // Rotating the token for the same account is allowed while a release is pending.
      const rotated = await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_pending_rotated_2000',
        actorId: actor.id,
        fetch: fake.fetchFn,
      })
      expect(rotated.tokenLast4).toBe('2000')

      // Changing the account or removing the credentials is not.
      await expect(
        saveCloudflareCredentials({
          organizationId: org.id,
          accountId: OTHER_ACCOUNT_ID,
          actorId: actor.id,
          fetch: fake.fetchFn,
        }),
      ).rejects.toThrow(/before changing the Cloudflare connection/)
      await expect(
        removeCloudflareCredentials({
          organizationId: org.id,
          actorId: actor.id,
        }),
      ).rejects.toThrow(/before changing the Cloudflare connection/)
      expect(await getCloudflareCredentialStatus(org.id)).toMatchObject({
        configured: true,
        accountId: ACCOUNT_ID,
        tokenLast4: '2000',
      })
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('removes the credentials and audits it; a second remove conflicts', async () => {
    const { actor, org } = await createActor('remove')
    try {
      await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_remove_secret_8888',
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      await expect(
        removeCloudflareCredentials({
          organizationId: org.id,
          actorId: actor.id,
        }),
      ).resolves.toEqual({ ok: true })
      expect(await getCloudflareCredentialStatus(org.id)).toMatchObject({
        configured: false,
      })
      await expect(
        removeCloudflareCredentials({
          organizationId: org.id,
          actorId: actor.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect((await actionsFor(org.id)).map((row) => row.action)).toContain(
        'organization.cloudflare_credentials_removed',
      )
    } finally {
      await cleanup(org.id, actor.id)
    }
  })

  it('refuses to save, verify or read without the encryption key', async () => {
    const { actor, org } = await createActor('nokey')
    const original = env.CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY
    try {
      await saveCloudflareCredentials({
        organizationId: org.id,
        accountId: ACCOUNT_ID,
        apiToken: 'cfut_nokey_secret_0000',
        actorId: actor.id,
        fetch: fakeCloudflare().fetchFn,
      })
      ;(
        env as { CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY?: string }
      ).CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY = undefined

      expect(await getCloudflareCredentialStatus(org.id)).toMatchObject({
        encryptionAvailable: false,
        configured: true,
      })
      await expect(
        saveCloudflareCredentials({
          organizationId: org.id,
          accountId: OTHER_ACCOUNT_ID,
          actorId: actor.id,
          fetch: fakeCloudflare().fetchFn,
        }),
      ).rejects.toThrow(/CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY is not set/)
      await expect(
        verifyCloudflareCredentials({
          organizationId: org.id,
          actorId: actor.id,
          fetch: fakeCloudflare().fetchFn,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
      await expect(
        getCloudflareClientForOrganization(org.id),
      ).rejects.toBeInstanceOf(ConflictError)
    } finally {
      ;(
        env as { CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY?: string }
      ).CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY = original
      await cleanup(org.id, actor.id)
    }
  })
})
