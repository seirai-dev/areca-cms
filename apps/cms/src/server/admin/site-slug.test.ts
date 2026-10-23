import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, site } from '#/db/schema'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'

import { changeSiteSlug, createSite } from './sites.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function slugOf(siteId: string) {
  const [row] = await db
    .select({ slug: site.slug })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  return row.slug
}

describe.skipIf(!hasDb)('changeSiteSlug', () => {
  it('changes the slug and writes an audit entry with the old and new value', async () => {
    const ctx = await createTestSite()
    try {
      const next = `renamed-${crypto.randomUUID().slice(0, 8)}`
      const updated = await changeSiteSlug(ctx.site.id, next, ctx.actor.id)
      expect(updated.slug).toBe(next)
      expect(await slugOf(ctx.site.id)).toBe(next)

      const entries = await db
        .select({ meta: auditLog.meta })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.action, 'site.update'),
          ),
        )
      expect(entries.map((entry) => entry.meta)).toContainEqual(
        expect.objectContaining({ previousSlug: ctx.site.slug, slug: next }),
      )
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('treats the current slug as a no-op', async () => {
    const ctx = await createTestSite()
    try {
      const result = await changeSiteSlug(
        ctx.site.id,
        ctx.site.slug,
        ctx.actor.id,
      )
      expect(result.slug).toBe(ctx.site.slug)
      const audits = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.siteId, ctx.site.id),
            eq(auditLog.action, 'site.update'),
          ),
        )
      expect(audits).toHaveLength(0)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('rejects a slug that breaks the shared rule and keeps the old one', async () => {
    const ctx = await createTestSite()
    try {
      await expect(
        changeSiteSlug(ctx.site.id, 'Not A Slug', ctx.actor.id),
      ).rejects.toBeInstanceOf(ValidationError)
      expect(await slugOf(ctx.site.id)).toBe(ctx.site.slug)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('refuses a slug another site already uses, with a conflict', async () => {
    const ctx = await createTestSite()
    const other = await createTestSite()
    try {
      await expect(
        changeSiteSlug(ctx.site.id, other.site.slug, ctx.actor.id),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(await slugOf(ctx.site.id)).toBe(ctx.site.slug)
    } finally {
      await cleanupTestSite(ctx)
      await cleanupTestSite(other)
    }
  })

  it('answers not found for a site that does not exist', async () => {
    const ctx = await createTestSite()
    try {
      await expect(
        changeSiteSlug(crypto.randomUUID(), 'new-slug', ctx.actor.id),
      ).rejects.toBeInstanceOf(NotFoundError)
    } finally {
      await cleanupTestSite(ctx)
    }
  })

  it('applies the same rule when a site is created', async () => {
    const ctx = await createTestSite()
    try {
      await expect(
        createSite({
          organizationId: ctx.org.id,
          name: 'Bad slug',
          slug: 'Bad Slug!',
          productionUrl: 'https://example.test',
          actorId: ctx.actor.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    } finally {
      await cleanupTestSite(ctx)
    }
  })
})
