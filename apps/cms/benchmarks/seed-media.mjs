import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { sql, quote as q } from './remote.mjs'
if (process.env.ARECA_BENCHMARK !== '1')
  throw new Error('Set ARECA_BENCHMARK=1')
const dir = new URL('./.local/', import.meta.url)
const fixtures = JSON.parse(await readFile(new URL('fixtures.json', dir)))
const require = createRequire(new URL('../package.json', import.meta.url))
const photo = await require('sharp')(await readFile(new URL('photo.jpg', dir)))
  .resize(640, 360)
  .jpeg({ quality: 75 })
  .toBuffer()
const sites = fixtures.orgs
  .flatMap((o) => o.sites.map((s) => q(s.id)))
  .join(',')
await sql(`UPDATE collection SET fields=fields||'[{"key":"heroImage","label":"Hero image","type":"image"}]'::jsonb WHERE site_id IN (${sites}) AND NOT fields @> '[{"key":"heroImage"}]'::jsonb;
UPDATE entry SET status=CASE WHEN substring(slug from '[0-9]+$')::int % 5=0 THEN 'published' WHEN substring(slug from '[0-9]+$')::int % 5=1 THEN 'archived' ELSE 'draft' END WHERE site_id IN (${sites}) AND slug LIKE 'sample-%';
UPDATE entry SET published_data=draft_data,published_slug=slug,published_at=now() WHERE site_id IN (${sites}) AND status='published';`)
const existing = JSON.parse(
  await sql(
    `SELECT coalesce(json_agg(original_filename),'[]') FROM asset WHERE organization_id IN (${fixtures.orgs.map((o) => q(o.id)).join(',')});`,
  ),
)
const seen = new Set(existing)
let created = 0
for (const org of fixtures.orgs) {
  const users = fixtures.users.filter((u) => u.organizationId === org.id)
  let next = 0
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (;;) {
        const i = next++
        if (i >= Math.min(45, users.length)) break
        const filename = `${fixtures.prefix}-seed-${org.id}-${i}.jpg`
        if (seen.has(filename)) continue
        const form = new FormData()
        form.set('organizationId', org.id)
        form.set('altText', `Editorial photo ${i}`)
        form.set('file', new Blob([photo], { type: 'image/jpeg' }), filename)
        const res = await fetch(`${fixtures.base}/api/assets/upload`, {
          method: 'POST',
          headers: { Cookie: users[i].cookie, Origin: fixtures.base },
          body: form,
          signal: AbortSignal.timeout(20000),
        })
        if (res.status !== 200)
          throw new Error(`Seed upload HTTP ${res.status}`)
        await res.arrayBuffer()
        created++
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }),
  )
  console.log(`Seeded media for ${org.slug}`)
}
await sql(
  `DELETE FROM organization WHERE slug LIKE ${q(`${fixtures.prefix}-preflight-%`)}; ANALYZE;`,
)
await writeFile(
  new URL('media-seed.json', dir),
  JSON.stringify({
    created,
    imageBytes: photo.length,
    at: new Date().toISOString(),
  }),
)
console.log(
  `Seed media complete: ${created} additional objects, ${photo.length} bytes each`,
)
