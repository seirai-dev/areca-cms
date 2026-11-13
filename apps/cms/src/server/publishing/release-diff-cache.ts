import { sql } from 'drizzle-orm'

import { db } from '#/db'

/**
 * Change fingerprints for the release diff, read for many sites in one query.
 *
 * A diff is a function of the rows `buildSnapshot` and the diff read, and of
 * the clock (a schedule falls due without a write). The fingerprint covers:
 * - the site row, and its production site's row for a development environment;
 * - every entry and collection of both (drafts too: link warnings show the
 *   title of a target that is not live);
 * - every asset of the organization (alt text, files, dimensions);
 * - the live and demo publications (go live, rollback);
 * - how many scheduled entries are due at `now`.
 *
 * Rows are fingerprinted by `xmin`, the id of the transaction that last wrote
 * them, so any write counts, whichever code path made it, without relying on
 * `updated_at`. A delete changes the row count and the sum.
 *
 * `now` is the application's clock, taken before the diff is built, so the
 * diff never sees fewer due schedules than its fingerprint counted.
 */
export async function releaseFingerprints(
  siteIds: string[],
  now: Date,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (siteIds.length === 0) return out
  const ids = sql.join(
    siteIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const result = await db.execute<{ id: string; fingerprint: string }>(sql`
    with s as (
      select s.id, s.organization_id, s.xmin::text as v,
        p.id as parent_id, p.xmin::text as parent_v
      from site s
      left join site p
        on p.id = s.parent_site_id and p.organization_id = s.organization_id
      where s.id in (${ids})
    ),
    scope as (
      select id from s
      union
      select parent_id from s where parent_id is not null
    ),
    e as (
      select site_id,
        count(*)::text || '.' ||
        coalesce(sum(hashtext(id || ':' || xmin::text)), 0)::text || '.' ||
        (count(*) filter (
          where status = 'scheduled'
            and scheduled_at <= ${now.toISOString()}::timestamptz
        ))::text as v
      from entry
      where site_id in (select id from scope)
      group by site_id
    ),
    c as (
      select site_id,
        count(*)::text || '.' ||
        coalesce(sum(hashtext(id || ':' || xmin::text)), 0)::text as v
      from collection
      where site_id in (select id from scope)
      group by site_id
    ),
    a as (
      select organization_id,
        count(*)::text || '.' ||
        coalesce(sum(hashtext(id || ':' || xmin::text)), 0)::text as v
      from asset
      where organization_id in (select organization_id from s)
      group by organization_id
    ),
    pb as (
      select site_id,
        count(*)::text || '.' ||
        coalesce(sum(hashtext(id || ':' || xmin::text)), 0)::text as v
      from publication
      where site_id in (select id from s) and status in ('live', 'demo')
      group by site_id
    )
    select s.id, concat_ws('|',
      s.v, coalesce(s.parent_v, '-'),
      coalesce(e1.v, '-'), coalesce(e2.v, '-'),
      coalesce(c1.v, '-'), coalesce(c2.v, '-'),
      coalesce(a.v, '-'), coalesce(pb.v, '-')
    ) as fingerprint
    from s
    left join e e1 on e1.site_id = s.id
    left join e e2 on e2.site_id = s.parent_id
    left join c c1 on c1.site_id = s.id
    left join c c2 on c2.site_id = s.parent_id
    left join a on a.organization_id = s.organization_id
    left join pb on pb.site_id = s.id
  `)
  for (const row of result.rows) out.set(row.id, row.fingerprint)
  return out
}

type CacheSlot<T> = { fingerprint: string; value: T; storedAt: number }

/**
 * One value per site, reused while the site's fingerprint is unchanged.
 * Least recently used sites are dropped past `max`; a value older than
 * `maxAgeMs` is rebuilt as a safety net. Concurrent misses for the same
 * site and fingerprint share one computation; a failed one is not kept.
 */
export function createFingerprintCache<T>(options: {
  max: number
  maxAgeMs: number
}) {
  const slots = new Map<string, CacheSlot<T>>()
  const pending = new Map<string, Promise<T>>()

  function store(siteId: string, slot: CacheSlot<T>) {
    slots.delete(siteId)
    slots.set(siteId, slot)
    while (slots.size > options.max) {
      const oldest = slots.keys().next().value
      if (oldest === undefined) break
      slots.delete(oldest)
    }
  }

  return {
    get(
      siteId: string,
      fingerprint: string,
      compute: () => Promise<T>,
    ): Promise<T> {
      const slot = slots.get(siteId)
      if (
        slot &&
        slot.fingerprint === fingerprint &&
        Date.now() - slot.storedAt < options.maxAgeMs
      ) {
        store(siteId, slot)
        return Promise.resolve(slot.value)
      }
      const key = `${siteId}\0${fingerprint}`
      const running = pending.get(key)
      if (running) return running
      const started = compute().then(
        (value) => {
          pending.delete(key)
          store(siteId, { fingerprint, value, storedAt: Date.now() })
          return value
        },
        (error: unknown) => {
          pending.delete(key)
          throw error
        },
      )
      pending.set(key, started)
      return started
    },
    clear() {
      slots.clear()
    },
    get size() {
      return slots.size
    },
  }
}
