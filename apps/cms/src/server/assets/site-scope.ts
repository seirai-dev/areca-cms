import { and, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '#/db'
import { asset } from '#/db/schema'
import { SEO_KEY } from '#/lib/seo'
import { loadAssetLookup } from './index'
import type { Asset } from './index'
import { richTextAssetRefs } from './richtext-ownership'
import { mayReferenceAssets } from './usage'

type AssetRefs = { ids: Set<string>; storageKeys: Set<string> }

/** jsonb::text of a value holding an image node; others cannot grant a storage key. */
const HAS_IMAGE_NODE = '%"type": "image"%'

/**
 * The asset ids and storage keys that the site's content grants: image fields
 * and the SEO OG image (ids), rich-text images (storage keys), in current
 * drafts, published and scheduled data, and every revision, by the fields of
 * the entry's collection; plus the resolved media and rich-text images of
 * every frozen publication. Only those values are read, not whole documents.
 * With `among`, documents that cannot mention those assets are skipped.
 */
async function siteReferences(
  siteId: string,
  among?: readonly Pick<Asset, 'id' | 'storageKey'>[],
): Promise<AssetRefs> {
  const mentions = (column: SQL) =>
    among ? mayReferenceAssets(among, [column]) : sql`true`
  const [fieldValues, publishedValues] = await Promise.all([
    db.execute<{ kind: string; value: unknown }>(sql`
      with docs as (
        select e.collection_id, d.data
        from entry e
        cross join lateral (
          values (e.draft_data), (e.published_data), (e.scheduled_data)
        ) as d(data)
        where e.site_id = ${siteId}
          and d.data is not null
          and ${mentions(sql`d.data`)}
        union all
        select e.collection_id, r.data
        from entry_revision r
        join entry e on e.id = r.entry_id
        where e.site_id = ${siteId} and ${mentions(sql`r.data`)}
      )
      select f.field ->> 'type' as kind, docs.data -> (f.field ->> 'key') as value
      from docs
      join collection c on c.id = docs.collection_id and c.site_id = ${siteId}
      cross join lateral jsonb_array_elements(c.fields) as f(field)
      where (
          f.field ->> 'type' = 'image'
          and jsonb_typeof(docs.data -> (f.field ->> 'key')) = 'string'
        ) or (
          f.field ->> 'type' = 'richtext'
          and (docs.data -> (f.field ->> 'key'))::text like ${HAS_IMAGE_NODE}
        )
      union all
      select 'image', docs.data -> ${SEO_KEY}::text -> 'ogImage'
      from docs
      where jsonb_typeof(docs.data -> ${SEO_KEY}::text -> 'ogImage') = 'string'
    `),
    // Frozen publications may outlive their schemas. Only resolved media fields
    // grant access; plain text, reference IDs and JSON-LD strings never do.
    // Site content sections ship with the release too, so their media counts.
    db.execute<{ kind: string; value: unknown }>(sql`
      with shipped as (
        select r.value as item
        from publication p
        cross join lateral jsonb_each(
          case when jsonb_typeof(p.snapshot -> 'collections') = 'object'
            then p.snapshot -> 'collections' else '{}'::jsonb end
        ) as c
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end
        ) as r(value)
        where p.site_id = ${siteId} and ${mentions(sql`p.snapshot`)}
        union all
        select g.value
        from publication p
        cross join lateral jsonb_each(
          case when jsonb_typeof(p.snapshot -> 'globals') = 'object'
            then p.snapshot -> 'globals' else '{}'::jsonb end
        ) as g
        where p.site_id = ${siteId} and ${mentions(sql`p.snapshot`)}
      ),
      seo_images as (
        select shipped.item -> 'seo' -> 'openGraph' -> 'image' as value from shipped
        union all
        select shipped.item -> 'seo' -> 'twitter' -> 'image' from shipped
      )
      select 'data' as kind, v.value
      from shipped
      cross join lateral jsonb_each(
        case when jsonb_typeof(shipped.item -> 'data') = 'object'
          then shipped.item -> 'data' else '{}'::jsonb end
      ) as v
      where jsonb_typeof(v.value) = 'object' and (
        (
          jsonb_typeof(v.value -> 'url') = 'string'
          and jsonb_typeof(v.value -> 'mimeType') = 'string'
        ) or (
          v.value -> 'json' ->> 'type' = 'doc'
          and (v.value -> 'json')::text like ${HAS_IMAGE_NODE}
        )
      )
      union all
      select 'seo', value
      from seo_images
      where jsonb_typeof(value -> 'url') = 'string'
        and jsonb_typeof(value -> 'mimeType') = 'string'
    `),
  ])
  const refs: AssetRefs = { ids: new Set(), storageKeys: new Set() }
  const addKeys = (value: unknown) => {
    for (const key of richTextAssetRefs(value).storageKeys)
      refs.storageKeys.add(key)
  }
  for (const { kind, value } of fieldValues.rows) {
    if (kind === 'richtext') addKeys(value)
    else if (typeof value === 'string' && value) refs.ids.add(value)
  }
  for (const { kind, value } of publishedValues.rows) {
    const media = value as {
      url?: unknown
      mimeType?: unknown
      json?: { type?: unknown } | null
    }
    if (typeof media.url === 'string' && typeof media.mimeType === 'string')
      addKeys({ type: 'image', attrs: { src: media.url } })
    if (kind === 'data' && media.json?.type === 'doc') addKeys(media.json)
  }
  return refs
}

/** A site's AI sees its own uploads and media actually referenced by its content. */
export async function siteAssets(
  organizationId: string,
  siteId: string,
): Promise<Asset[]> {
  const [uploads, refs] = await Promise.all([
    db
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.organizationId, organizationId),
          eq(asset.originSiteId, siteId),
        ),
      ),
    siteReferences(siteId),
  ])
  const lookup = await loadAssetLookup(organizationId, {
    ids: refs.ids,
    storageKeys: refs.storageKeys,
  })
  const visible = new Map<string, Asset>(uploads.map((row) => [row.id, row]))
  for (const row of lookup.byId.values()) visible.set(row.id, row)
  return [...visible.values()].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  )
}

/**
 * The assets among these ids and storage keys that `siteAssets` would list,
 * read with queries about those assets only (none when there are none).
 */
export async function siteAssetsAmong(
  organizationId: string,
  siteId: string,
  refs: { ids: readonly string[]; storageKeys: readonly string[] },
): Promise<Asset[]> {
  if (refs.ids.length === 0 && refs.storageKeys.length === 0) return []
  const lookup = await loadAssetLookup(organizationId, refs)
  const candidates = [...lookup.byId.values()]
  const shared = candidates.filter((row) => row.originSiteId !== siteId)
  if (shared.length === 0) return candidates
  const granted = await siteReferences(siteId, shared)
  return candidates.filter(
    (row) =>
      row.originSiteId === siteId ||
      granted.ids.has(row.id) ||
      granted.storageKeys.has(row.storageKey),
  )
}

export async function siteAssetLookup(
  organizationId: string,
  siteId: string,
  refs: { ids: readonly string[]; storageKeys: readonly string[] },
) {
  const rows = await siteAssetsAmong(organizationId, siteId, refs)
  return {
    byId: new Map(rows.map((row) => [row.id, row])),
    byStorageKey: new Map(rows.map((row) => [row.storageKey, row])),
  }
}
