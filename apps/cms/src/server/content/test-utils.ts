import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { collection, organization, site, user } from '#/db/schema'
import type { Field } from '#/lib/types'

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

export async function createTestSite() {
  const suffix = crypto.randomUUID()
  const [org] = await db
    .insert(organization)
    .values({ name: `Test Org ${suffix}`, slug: `test-org-${suffix}` })
    .returning()
  if (!org) throw new Error('Failed to create org')

  const [actor] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: 'Test Actor',
      email: `actor-${suffix}@test.local`,
      emailVerified: true,
    })
    .returning()
  if (!actor) throw new Error('Failed to create user')

  const rawToken = randomBytes(32).toString('hex')
  const schemaToken = randomBytes(32).toString('hex')
  const previewSecret = randomBytes(32).toString('hex')
  const [createdSite] = await db
    .insert(site)
    .values({
      organizationId: org.id,
      name: `Test Site ${suffix}`,
      slug: `test-site-${suffix}`,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      schemaTokenHash: createHash('sha256').update(schemaToken).digest('hex'),
      productionUrl: 'http://localhost:3999',
      previewSecret,
    })
    .returning()
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
  input: { key?: string; routePattern?: string; fields?: Field[] } = {},
) {
  const [col] = await db
    .insert(collection)
    .values({
      siteId,
      key: input.key ?? 'articles',
      label: 'Articles',
      routePattern: input.routePattern ?? '/blog/$slug',
      fields: input.fields ?? articleFields(),
      enabled: true,
    })
    .returning()
  if (!col) throw new Error('Failed to create collection')
  return col
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
