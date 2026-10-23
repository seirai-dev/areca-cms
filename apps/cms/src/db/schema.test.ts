import { eq, TransactionRollbackError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe.skipIf(!process.env.DATABASE_URL)('cms schema', () => {
  it('inserts and reads organization, site, collection, and entry', async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { Pool } = await import('pg')
    const schema = await import('./schema.ts')

    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const db = drizzle(pool, { schema })

    try {
      await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(schema.organization)
          .values({ name: 'Test Org', slug: `test-org-${crypto.randomUUID()}` })
          .returning()

        expect(org).toBeDefined()

        const [createdSite] = await tx
          .insert(schema.site)
          .values({
            organizationId: org.id,
            name: 'Test Site',
            slug: `test-site-${crypto.randomUUID()}`,
            tokenHash: crypto.randomUUID(),
            productionUrl: 'http://localhost:3999',
            previewSecret: crypto.randomUUID(),
          })
          .returning()

        expect(createdSite).toBeDefined()

        const [createdCollection] = await tx
          .insert(schema.collection)
          .values({
            siteId: createdSite.id,
            key: 'articles',
            label: 'Articles',
            routePattern: '/blog/$slug',
            fields: [
              { key: 'title', label: 'Title', type: 'text', required: true },
            ],
          })
          .returning()

        expect(createdCollection).toBeDefined()

        const [createdEntry] = await tx
          .insert(schema.entry)
          .values({
            siteId: createdSite.id,
            collectionId: createdCollection.id,
            slug: 'hello-world',
            status: 'draft',
            draftData: { title: 'Hello' },
          })
          .returning()

        expect(createdEntry).toBeDefined()

        const readOrg = (
          await tx
            .select()
            .from(schema.organization)
            .where(eq(schema.organization.id, org.id))
        ).at(0)

        const readEntry = (
          await tx
            .select()
            .from(schema.entry)
            .where(eq(schema.entry.id, createdEntry.id))
        ).at(0)

        expect(readOrg?.name).toBe('Test Org')
        expect(readEntry?.slug).toBe('hello-world')
        expect(readEntry?.draftData).toEqual({ title: 'Hello' })

        tx.rollback()
      })
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) {
        throw error
      }
    } finally {
      await pool.end()
    }
  })
})
