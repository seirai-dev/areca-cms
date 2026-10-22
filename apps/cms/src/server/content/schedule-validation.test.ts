import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { entry } from '#/db/schema'
import {
  isIanaTimeZone,
  isPastInstant,
  parseOffsetInstant,
  zonedToInstant,
} from '#/lib/schedule-time'
import { m } from '#/paraglide/messages'

import {
  cancelSchedule,
  createEntry,
  publishEntry,
  scheduleEntry,
} from './entries.ts'
import { ValidationError } from './errors.ts'
import {
  createTestCollection,
  dueScheduleIso,
  sampleRichText,
  withTestSite,
} from './test-utils.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function seedDraft(ctx: {
  site: { id: string }
  actor: { id: string }
  suffix: string
}) {
  await createTestCollection(ctx.site.id)
  return createEntry({
    siteId: ctx.site.id,
    collectionKey: 'articles',
    data: {
      title: 'Hello',
      slug: `sched-${ctx.suffix}`,
      excerpt: '',
      body: sampleRichText,
    },
    actorId: ctx.actor.id,
  })
}

describe('schedule time validation helpers', () => {
  it('accepts UTC and rejects empty or invalid IANA zones', () => {
    expect(isIanaTimeZone('UTC')).toBe(true)
    expect(isIanaTimeZone('Europe/Amsterdam')).toBe(true)
    expect(isIanaTimeZone('')).toBe(false)
    expect(isIanaTimeZone('Not/AZone')).toBe(false)
    expect(isIanaTimeZone('America/Not_A_City')).toBe(false)
    expect(isIanaTimeZone('+02:00')).toBe(false)
  })

  it('rejects zone-less instants and accepts offset ISO', () => {
    expect(parseOffsetInstant('2026-12-01T09:00:00')).toBeNull()
    expect(parseOffsetInstant('2026-12-01T09:00:00Z')?.toISOString()).toBe(
      '2026-12-01T09:00:00.000Z',
    )
    expect(parseOffsetInstant('2026-12-01T09:00:00+02:00')?.toISOString()).toBe(
      '2026-12-01T07:00:00.000Z',
    )
  })

  it('allows 60s skew for “now” but rejects older past instants', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    expect(isPastInstant(new Date(now.getTime() - 30_000), now)).toBe(false)
    expect(isPastInstant(new Date(now.getTime() - 61_000), now)).toBe(true)
    expect(isPastInstant(new Date(now.getTime() + 60_000), now)).toBe(false)
  })

  it('rejects the 2026 Amsterdam spring-forward gap', () => {
    expect(zonedToInstant('2026-03-29', '02:30', 'Europe/Amsterdam')).toBeNull()
  })

  it('picks CET (later UTC) at the 2026 Amsterdam fall-back fold', () => {
    expect(
      zonedToInstant('2026-10-25', '02:30', 'Europe/Amsterdam')?.toISOString(),
    ).toBe('2026-10-25T01:30:00.000Z')
  })
})

describe.skipIf(!hasDb)('scheduleEntry validation', () => {
  it('rejects invalid and empty time zones and accepts UTC', async () => {
    await withTestSite(async (ctx) => {
      const created = await seedDraft(ctx)
      const future = new Date(Date.now() + 60_000).toISOString()
      await expect(
        scheduleEntry(created.id, future, 'Not/AZone', ctx.actor.id),
      ).rejects.toMatchObject({
        errors: [{ path: 'timezone', message: m.server_invalid_timezone() }],
      })
      await expect(
        scheduleEntry(created.id, future, '', ctx.actor.id),
      ).rejects.toMatchObject({
        errors: [{ path: 'timezone', message: m.server_timezone_required() }],
      })
      const scheduled = await scheduleEntry(
        created.id,
        future,
        'UTC',
        ctx.actor.id,
      )
      expect(scheduled.scheduleTimezone).toBe('UTC')
      expect(scheduled.scheduledBy).toBe(ctx.actor.id)
    })
  })

  it('rejects zone-less datetimes and far-past instants; allows 30s skew', async () => {
    await withTestSite(async (ctx) => {
      const created = await seedDraft(ctx)
      await expect(
        scheduleEntry(created.id, '2026-12-01T09:00:00', 'UTC', ctx.actor.id),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        scheduleEntry(
          created.id,
          '2020-01-01T00:00:00.000Z',
          'UTC',
          ctx.actor.id,
        ),
      ).rejects.toMatchObject({
        errors: [{ path: 'scheduledAt', message: m.server_schedule_in_past() }],
      })
      const skewed = await scheduleEntry(
        created.id,
        dueScheduleIso(),
        'UTC',
        ctx.actor.id,
      )
      expect(skewed.status).toBe('scheduled')
      expect(skewed.scheduledBy).toBe(ctx.actor.id)
    })
  })

  it('accepts a future instant and stores scheduledBy', async () => {
    await withTestSite(async (ctx) => {
      const created = await seedDraft(ctx)
      const future = new Date(Date.now() + 3_600_000).toISOString()
      const scheduled = await scheduleEntry(
        created.id,
        future,
        'Europe/Amsterdam',
        ctx.actor.id,
      )
      expect(scheduled.status).toBe('scheduled')
      expect(scheduled.scheduledBy).toBe(ctx.actor.id)
      expect(scheduled.scheduledAt?.toISOString()).toBe(future)
    })
  })

  it('cancelSchedule after publish-then-schedule restores published status and slug', async () => {
    await withTestSite(async (ctx) => {
      const created = await seedDraft(ctx)
      const published = await publishEntry(created.id, ctx.actor.id)
      expect(published.status).toBe('published')
      expect(published.publishedSlug).toBe(created.slug)
      const scheduled = await scheduleEntry(
        created.id,
        new Date(Date.now() + 3_600_000).toISOString(),
        'UTC',
        ctx.actor.id,
      )
      expect(scheduled.status).toBe('scheduled')
      expect(scheduled.scheduledBy).toBe(ctx.actor.id)
      const cancelled = await cancelSchedule(created.id, ctx.actor.id)
      expect(cancelled.status).toBe('published')
      expect(cancelled.publishedSlug).toBe(published.publishedSlug)
      expect(cancelled.publishedData).toEqual(published.publishedData)
      expect(cancelled.scheduledBy).toBeNull()
      expect(cancelled.scheduledAt).toBeNull()
      const row = (await db
        .select()
        .from(entry)
        .where(eq(entry.id, created.id))
        .limit(1)).at(0)
      expect(row?.status).toBe('published')
      expect(row?.publishedSlug).toBe(created.slug)
      expect(row?.scheduledBy).toBeNull()
    })
  })
})
