import { createHash, randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, organization, site, user } from '#/db/schema'
import type { Field, SiteLanguages } from '#/lib/types'
import { assetAttachLock } from '#/server/assets/usage'

export const sampleRichText = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: 'Hello world' }],
    },
  ],
}

export function articleFields(): Field[] {
  return [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'slug', label: 'Slug', type: 'slug', required: true },
    { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
    { key: 'body', label: 'Body', type: 'richtext', required: true },
    { key: 'heroImage', label: 'Hero image', type: 'image' },
    { key: 'publishedAt', label: 'Published at', type: 'datetime' },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      options: ['news', 'updates'],
    },
  ]
}

export async function createTestSite(
  input: { languages?: SiteLanguages | null } = {},
) {
  const suffix = crypto.randomUUID()
  const org = (
    await db
      .insert(organization)
      .values({ name: `Test Org ${suffix}`, slug: `test-org-${suffix}` })
      .returning()
  ).at(0)
  if (!org) throw new Error('Failed to create org')

  const actor = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Test Actor',
        email: `actor-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
  ).at(0)
  if (!actor) throw new Error('Failed to create user')

  const rawToken = randomBytes(32).toString('hex')
  const schemaToken = randomBytes(32).toString('hex')
  const previewSecret = randomBytes(32).toString('hex')
  const createdSite = (
    await db
      .insert(site)
      .values({
        organizationId: org.id,
        name: `Test Site ${suffix}`,
        slug: `test-site-${suffix}`,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        schemaTokenHash: createHash('sha256').update(schemaToken).digest('hex'),
        productionUrl: 'http://localhost:3999',
        previewSecret,
        languages: input.languages ?? null,
      })
      .returning()
  ).at(0)
  if (!createdSite) throw new Error('Failed to create site')

  return {
    org,
    actor,
    site: createdSite,
    token: rawToken,
    schemaToken,
    previewSecret,
    suffix,
  }
}

export async function createTestCollection(
  siteId: string,
  input: {
    key?: string
    routePattern?: string
    fields?: Field[]
    requiredLanguages?: string[]
    localizedRoutes?: Record<string, string> | null
  } = {},
) {
  const col = (
    await db
      .insert(collection)
      .values({
        siteId,
        key: input.key ?? 'articles',
        label: 'Articles',
        routePattern: input.routePattern ?? '/blog/$slug',
        fields: input.fields ?? articleFields(),
        enabled: true,
        requiredLanguages: input.requiredLanguages ?? [],
        localizedRoutes: input.localizedRoutes ?? null,
      })
      .returning()
  ).at(0)
  if (!col) throw new Error('Failed to create collection')
  return col
}

export function globalFields(): Field[] {
  return [
    {
      key: 'email',
      label: 'Email',
      type: 'text',
      required: true,
      group: 'Contact',
    },
    { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
  ]
}

/**
 * Site content section as the storage contract describes it: one `collection`
 * row with kind 'global' and exactly one entry with slug '$global'.
 */
export async function createTestGlobal(
  siteId: string,
  input: {
    key?: string
    label?: string
    fields?: Field[]
    seoEnabled?: boolean
    previewPath?: string | null
    enabled?: boolean
    requiredLanguages?: string[]
  } = {},
) {
  return db.transaction(async (tx) => {
    const col = (
      await tx
        .insert(collection)
        .values({
          siteId,
          key: input.key ?? 'companyInfo',
          label: input.label ?? 'Company info',
          routePattern: '',
          kind: 'global',
          fields: input.fields ?? globalFields(),
          enabled: input.enabled ?? true,
          seoEnabled: input.seoEnabled ?? false,
          previewPath: input.previewPath ?? null,
          requiredLanguages: input.requiredLanguages ?? [],
        })
        .returning()
    ).at(0)
    if (!col) throw new Error('Failed to create global')
    const row = (
      await tx
        .insert(entry)
        .values({
          siteId,
          collectionId: col.id,
          slug: '$global',
          status: 'draft',
        })
        .returning()
    ).at(0)
    if (!row) throw new Error('Failed to create global entry')
    return { collection: col, entry: row }
  })
}

/**
 * A second production site in an existing organization, for tests that need
 * two sites of one organization (a site that is not another's dev environment).
 */
export async function createSiteInOrganization(organizationId: string) {
  const suffix = crypto.randomUUID()
  const rawToken = randomBytes(32).toString('hex')
  const createdSite = (
    await db
      .insert(site)
      .values({
        organizationId,
        name: `Sibling Site ${suffix}`,
        slug: `sibling-site-${suffix}`,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        schemaTokenHash: createHash('sha256')
          .update(randomBytes(32).toString('hex'))
          .digest('hex'),
        productionUrl: 'http://localhost:3998',
        previewSecret: randomBytes(32).toString('hex'),
      })
      .returning()
  ).at(0)
  if (!createdSite) throw new Error('Failed to create sibling site')
  return createdSite
}

export async function cleanupTestSite(input: {
  org: { id: string }
  actor: { id: string }
}) {
  await db.delete(organization).where(eq(organization.id, input.org.id))
  await db.delete(user).where(eq(user.id, input.actor.id))
}

export async function withTestSite(
  run: (ctx: Awaited<ReturnType<typeof createTestSite>>) => Promise<void>,
) {
  const ctx = await createTestSite()
  try {
    await run(ctx)
  } finally {
    await cleanupTestSite(ctx)
  }
}

/** Instant within the 60s schedule skew so tests can enqueue already-due work. */
export function dueScheduleIso() {
  return new Date(Date.now() - 30_000).toISOString()
}

/**
 * Holds the asset lock an ordinary entry save takes (server/assets/usage.ts),
 * as a save in progress does. `write` runs inside the holding transaction first,
 * so its rows are uncommitted until `release` is called. `done` settles then.
 */
export async function holdEntryLock(
  organizationId: string,
  write?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<void>,
) {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let acquired!: () => void
  const held = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const done = db.transaction(async (tx) => {
    await assetAttachLock(tx, organizationId)
    await write?.(tx)
    acquired()
    await released
  })
  await held
  return { release, done }
}

/**
 * Starts `work` and reports, after `waitMs`, whether it has settled. `outcome`
 * settles with the result or the error, and never rejects.
 */
export function observe<T>(work: Promise<T>, waitMs = 300) {
  let settled = false
  const outcome = work.then(
    (value) => {
      settled = true
      return { ok: true as const, value }
    },
    (error: unknown) => {
      settled = true
      return { ok: false as const, error }
    },
  )
  return {
    outcome,
    /** True once the work has settled, after `waitMs` of waiting. */
    async settledAfterWait() {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      return settled
    },
  }
}

/**
 * Waits until a backend is blocked on the advisory lock hashed from `key`
 * (`hashtextextended(key, 0)`, the asset lock). Matched on the lock key, so a
 * waiter from another test does not count.
 */
export async function waitForAdvisoryWaiter(key: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const waiting = await db.execute<{ n: number }>(sql`
      with k as (select hashtextextended(${key}, 0) as v)
      select count(*)::int as n
      from pg_locks l, k
      where l.locktype = 'advisory' and not l.granted
        and l.classid::bigint = ((k.v >> 32) & 4294967295)
        and l.objid::bigint = (k.v & 4294967295)
    `)
    if (Number(waiting.rows[0].n) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`no backend waited on the advisory lock for ${key}`)
}
