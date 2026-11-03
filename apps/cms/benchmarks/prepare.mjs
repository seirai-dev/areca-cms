import { randomUUID, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { ssh, sql, quote as q, app, service } from './remote.mjs'
import { discoverRpcManifest } from './rpc-manifest.mjs'
if (process.env.ARECA_BENCHMARK !== '1')
  throw new Error('Set ARECA_BENCHMARK=1 to seed the disposable deployment')
const base = process.env.BENCH_URL
if (!base || new URL(base).protocol !== 'https:')
  throw new Error('Set BENCH_URL to the disposable HTTPS deployment')
const count = Number(process.env.BENCH_USERS ?? 2000)
if (!Number.isInteger(count) || count < 2 || count > 2000)
  throw new Error('BENCH_USERS must be 2..2000')
const prefix = `load-${Date.now().toString(36)}`
const local = new URL('./.local/', import.meta.url)
await mkdir(local, { recursive: true })
// Read compiled SSR RPC stubs from the actual image. IDs change with deployments.
const manifest = await discoverRpcManifest()
for (const name of [
  'getMeFn',
  'listCollectionsFn',
  'listEntriesFn',
  'getEntryFn',
  'createEntryFn',
  'updateDraftFn',
  'listAssetsFn',
  'createOrganizationFn',
  'createSiteFn',
]) {
  if (!manifest[name])
    throw new Error(`Cannot discover deployed RPC ${name}; no data was seeded`)
}
await writeFile(
  new URL('manifest.json', local),
  JSON.stringify(manifest, null, 2),
)
const require = createRequire(new URL('../package.json', import.meta.url))
const { hashPassword } = await import(
  pathToFileURL(require.resolve('better-auth/crypto')).href
)
const password = randomBytes(24).toString('base64url')
const hash = await hashPassword(password)
const orgs = Array.from(
  { length: Math.min(40, Math.ceil(count / 50)) },
  (_, i) => ({ id: randomUUID(), slug: `${prefix}-client-${i}`, sites: [] }),
)
const statements = ['BEGIN;']
const insert = (table, cols, values) =>
  statements.push(
    `INSERT INTO ${table} (${cols}) VALUES (${values.map(q).join(',')});`,
  )
const fields = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
]
for (const org of orgs) {
  insert('organization', 'id,name,slug', [org.id, org.slug, org.slug])
  for (let s = 0; s < 2; s++) {
    const siteId = randomUUID(),
      collections = []
    insert(
      'site',
      'id,organization_id,name,slug,token_hash,preview_secret,production_url,publishing_mode',
      [
        siteId,
        org.id,
        `${org.slug}-${s}`,
        `${org.slug}-${s}`,
        randomBytes(32).toString('hex'),
        randomBytes(32).toString('hex'),
        'https://example.invalid',
        'demo',
      ],
    )
    for (const key of ['articles', 'news', 'pages']) {
      const id = randomUUID()
      collections.push({ id, key })
      insert('collection', 'id,site_id,key,label,route_pattern,fields', [
        id,
        siteId,
        key,
        key,
        `/${key}/$slug`,
        JSON.stringify(fields),
      ])
      for (let j = 0; j < 30; j++) {
        const data = {
          title: `Sample ${key} ${j}`,
          slug: `sample-${j}`,
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Sample editorial content. '.repeat(80),
                  },
                ],
              },
            ],
          },
        }
        insert('entry', 'id,site_id,collection_id,slug,draft_data', [
          randomUUID(),
          siteId,
          id,
          data.slug,
          JSON.stringify(data),
        ])
      }
    }
    org.sites.push({ id: siteId, collections })
  }
}
const users = []
for (let i = 0; i < count; i++) {
  const org = orgs[i % orgs.length],
    site = org.sites[Math.floor(i / orgs.length) % 2]
  const id = randomUUID(),
    sessionId = randomUUID(),
    token = randomBytes(32).toString('hex')
  // Interleave personas so even the 10-user tier contains an admin and owners.
  const role = i % 20 === 0 ? 'admin' : i % 4 === 0 ? 'owner' : 'editor'
  const email = `${prefix}-${i}@benchmark.invalid`
  insert(
    '"user"',
    'id,name,email,email_verified,is_agency_admin,two_factor_enabled,locale',
    [
      id,
      `Benchmark user ${i}`,
      email,
      true,
      role === 'admin',
      role === 'admin',
      'en',
    ],
  )
  insert('account', 'id,user_id,account_id,provider_id,password', [
    randomUUID(),
    id,
    id,
    'credential',
    hash,
  ])
  insert('membership', 'id,user_id,organization_id,role', [
    randomUUID(),
    id,
    org.id,
    role === 'editor' ? 'editor' : 'owner',
  ])
  statements.push(
    `INSERT INTO session (id,user_id,token,expires_at) VALUES (${q(sessionId)},${q(id)},${q(token)},now()+interval '24 hours');`,
  )
  if (role === 'admin')
    statements.push(
      `INSERT INTO verification (id,identifier,value,expires_at) VALUES (${q(`local-mfa:${sessionId}`)},${q(`local-mfa:${sessionId}`)},${q(id)},now()+interval '24 hours');`,
    )
  const entries = []
  for (const c of site.collections) {
    const entryId = randomUUID(),
      slug = `user-${i}-${c.key}`
    const data = {
      title: `User ${i} ${c.key}`,
      slug,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'An editable draft. '.repeat(120) },
            ],
          },
        ],
      },
    }
    insert(
      'entry',
      'id,site_id,collection_id,slug,draft_data,created_by,updated_by',
      [entryId, site.id, c.id, slug, JSON.stringify(data), id, id],
    )
    entries.push({ id: entryId, key: c.key })
  }
  users.push({
    id,
    email,
    role,
    token,
    sessionId,
    organizationId: org.id,
    siteId: site.id,
    entries,
  })
}
statements.push('COMMIT; ANALYZE;')
await sql(statements.join('\n'))
// Sign only synthetic tokens inside the container; the auth signing secret never leaves it.
const signer = `const crypto=require('node:crypto');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const tokens=JSON.parse(s);console.log(JSON.stringify(tokens.map(t=>encodeURIComponent(t+'.'+crypto.createHmac('sha256',process.env.BETTER_AUTH_SECRET).update(t).digest('base64')))))})`
const signed = JSON.parse(
  await ssh(
    `docker exec -i ${app} node -e '${signer.replaceAll("'", "'\\''")}'`,
    JSON.stringify(users.map((u) => u.token)),
  ),
)
users.forEach((u, i) => {
  u.cookie = `__Secure-better-auth.session_token=${signed[i]}`
  delete u.token
})
const config = {
  base,
  image: (
    await ssh(`docker inspect --format '{{.Config.Image}}' ${app}`)
  ).trim(),
  imageId: (await ssh(`docker inspect --format '{{.Image}}' ${app}`)).trim(),
  service,
  prefix,
  createdAt: new Date().toISOString(),
  password,
  users,
  orgs,
}
await writeFile(new URL('fixtures.json', local), JSON.stringify(config), {
  mode: 0o600,
})
await writeFile(
  new URL('inventory.json', local),
  JSON.stringify(
    {
      prefix,
      count,
      organizations: orgs.length,
      sites: orgs.length * 2,
      collections: orgs.length * 6,
      entries: orgs.length * 180 + count * 3,
      personas: Object.fromEntries(
        ['admin', 'owner', 'editor'].map((r) => [
          r,
          users.filter((u) => u.role === r).length,
        ]),
      ),
    },
    null,
    2,
  ),
)
console.log(
  `Seeded ${count} users (${prefix}); private credentials and sessions saved under ignored .local/`,
)
