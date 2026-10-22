import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { collection, entry, organization, site, user } from '#/db/schema'
import type { Field, SiteLanguages } from '#/lib/types'

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
  const org = (await db
    .insert(organization)
    .values({ name: `Test Org ${suffix}`, slug: `test-org-${suffix}` })
    .returning()).at(0)
  if (!org) throw new Error('Failed to create org')

  const actor = (await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: 'Test Actor',
      email: `actor-${suffix}@test.local`,
      emailVerified: true,
    })
    .returning()).at(0)
  if (!actor) throw new Error('Failed to create user')

  const rawToken = randomBytes(32).toString('hex')
  const schemaToken = randomBytes(32).toString('hex')
  const previewSecret = randomBytes(32).toString('hex')
  const createdSite = (await db
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
    .returning()).at(0)
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
  const col = (await db
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
    .returning()).at(0)
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
    const col = (await tx
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
      .returning()).at(0)
    if (!col) throw new Error('Failed to create global')
    const row = (await tx
      .insert(entry)
      .values({
        siteId,
        collectionId: col.id,
        slug: '$global',
        status: 'draft',
      })
      .returning()).at(0)
    if (!row) throw new Error('Failed to create global entry')
    return { collection: col, entry: row }
  })
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
