import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db, pool } from '#/db'
import {
  collection,
  membership,
  organization,
  site,
  user,
} from '#/db/schema'
import { auth } from '#/lib/auth'
import type { Field } from '#/lib/types'

const ADMIN_EMAIL = 'admin@areca.local'
const PASSWORD = 'password123'

const articleFields: Field[] = [
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

async function signUp(name: string, email: string) {
  const result = await auth.api.signUpEmail({
    body: { name, email, password: PASSWORD },
  })
  if (!result.user) {
    throw new Error(`Failed to create user ${email}`)
  }
  return result.user
}

async function main() {
  const [existingAdmin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, ADMIN_EMAIL))
    .limit(1)

  if (existingAdmin) {
    console.log('Seed already applied (admin exists), skipping.')
    return
  }

  const admin = await signUp('Agency Admin', ADMIN_EMAIL)
  await db
    .update(user)
    .set({ isAgencyAdmin: true })
    .where(eq(user.id, admin.id))

  const owner = await signUp('Acme Owner', 'owner@acme.local')
  const editor = await signUp('Acme Editor', 'editor@acme.local')

  const [org] = await db
    .insert(organization)
    .values({ name: 'Acme', slug: 'acme' })
    .returning()

  if (!org) {
    throw new Error('Failed to create organization')
  }

  await db.insert(membership).values([
    { userId: owner.id, organizationId: org.id, role: 'owner' },
    { userId: editor.id, organizationId: org.id, role: 'editor' },
  ])

  const siteToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(siteToken).digest('hex')
  const previewSecret = randomBytes(32).toString('hex')

  const [createdSite] = await db
    .insert(site)
    .values({
      organizationId: org.id,
      name: 'acme-site',
      slug: 'acme-site',
      tokenHash,
      productionUrl: 'http://localhost:3001',
      previewSecret,
    })
    .returning()

  if (!createdSite) {
    throw new Error('Failed to create site')
  }

  await db.insert(collection).values({
    siteId: createdSite.id,
    key: 'articles',
    label: 'Articles',
    routePattern: '/blog/$slug',
    fields: articleFields,
    enabled: true,
  })

  console.log('Seed complete.')
  console.log(`Site token: ${siteToken}`)
}

try {
  await main()
} finally {
  await pool.end()
}
