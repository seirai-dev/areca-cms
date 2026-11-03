import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { rpcRequest, decode } from './.local/wire.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const sharp = require('sharp')
const dir = new URL('./.local/', import.meta.url)
const config = JSON.parse(await readFile(new URL('fixtures.json', dir)))
const manifest = JSON.parse(await readFile(new URL('manifest.json', dir)))
await writeFile(
  new URL('config.json', dir),
  JSON.stringify({ base: config.base, prefix: config.prefix }),
)
// Repeatable, non-identical image bytes; about 200 KiB of real JPEG data.
const width = 1280,
  height = 720,
  pixels = Buffer.alloc(width * height * 3)
let seed = 1789
for (let i = 0; i < pixels.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  pixels[i] = seed >>> 24
}
const image = await sharp(pixels, { raw: { width, height, channels: 3 } })
  .jpeg({ quality: 65 })
  .toBuffer()
await writeFile(new URL('photo.jpg', dir), image)
let user = config.users.find((u) => u.role === 'owner')
const results = []
const page = await fetch(`${config.base}/sites/${user.siteId}/c/articles`, {
  headers: { Cookie: user.cookie },
  redirect: 'manual',
})
assert.equal(page.status, 200, 'Authenticated page document failed')
assert.ok((await page.text()).toLowerCase().includes('<!doctype html'))
results.push('pageDocument')
async function rpc(name, data = {}, check = () => true) {
  const req = rpcRequest(config.base, manifest, name, data, user.cookie)
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  assert.equal(
    res.status,
    200,
    `${name} HTTP ${res.status}: ${text.slice(0, 200)}`,
  )
  let value
  try {
    value = decode(text)
  } catch (error) {
    throw new Error(
      `${name} decode: ${error.message}; response ${text.slice(0, 700)}`,
    )
  }
  assert.ok(
    check(value),
    `${name} invalid shape: ${JSON.stringify(value)?.slice(0, 700)}`,
  )
  results.push(name)
  return value
}
await rpc('getMeFn', {}, (v) => v?.user?.id === user.id)
await rpc('listCollectionsFn', { siteId: user.siteId }, Array.isArray)
if (manifest.listEntryCountsFn)
  await rpc(
    'listEntryCountsFn',
    { siteId: user.siteId },
    (v) => v && Number.isInteger(v.articles) && v.articles > 0,
  )
await rpc('listGlobalsFn', { siteId: user.siteId }, Array.isArray)
await rpc(
  'listEntriesFn',
  { siteId: user.siteId, collectionKey: 'articles', limit: 25, offset: 0 },
  (v) => Array.isArray(v?.items),
)
await rpc('getEntryFn', { id: user.entries[0].id }, (v) => Boolean(v?.id))
const slug = `${config.prefix}-preflight-${Date.now()}`
const data = {
  title: 'Preflight editorial article',
  slug,
  body: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Functional check of a benchmark article.' },
        ],
      },
    ],
  },
}
let entry = await rpc(
  'createEntryFn',
  { siteId: user.siteId, collectionKey: 'articles', data },
  (v) => Boolean(v?.id),
)
entry = await rpc(
  'updateDraftFn',
  {
    id: entry.id,
    data: { ...data, title: 'Saved preflight article' },
    expectedVersion: entry.draftVersion,
  },
  (v) => v?.draftVersion === 2,
)
await rpc(
  'getEntryFn',
  { id: entry.id },
  (v) => v?.draftData?.title === 'Saved preflight article',
)
await rpc(
  'getPreviewUrlFn',
  { siteId: user.siteId, collection: 'articles', slug },
  (v) => typeof v?.url === 'string',
)
await rpc('listRevisionsFn', { entryId: entry.id, limit: 20 }, (v) =>
  Array.isArray(v?.items),
)
await rpc('listInboundReferencesFn', { id: entry.id }, Array.isArray)
await rpc(
  'publishEntryFn',
  { id: entry.id, expectedVersion: 2 },
  (v) => v?.status === 'published',
)
await rpc('unpublishEntryFn', { id: entry.id }, (v) => v?.status === 'draft')
await rpc(
  'scheduleEntryFn',
  {
    id: entry.id,
    expectedVersion: 2,
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    timezone: 'Europe/Brussels',
  },
  (v) => v?.status === 'scheduled',
)
await rpc('cancelScheduleFn', { id: entry.id }, (v) => v?.status === 'draft')
await rpc('archiveEntryFn', { id: entry.id }, (v) => v?.status === 'archived')
await rpc('deleteEntryFn', { id: entry.id }, (v) => v?.ok === true)
await rpc(
  'listAssetsFn',
  { organizationId: user.organizationId, limit: 40, offset: 0 },
  Array.isArray,
)
const form = new FormData()
form.set('organizationId', user.organizationId)
form.set(
  'file',
  new Blob([image], { type: 'image/jpeg' }),
  'benchmark-preflight.jpg',
)
const upload = await fetch(`${config.base}/api/assets/upload`, {
  method: 'POST',
  headers: { Cookie: user.cookie, Origin: config.base },
  body: form,
})
assert.equal(
  upload.status,
  200,
  `Upload failed: ${await (upload.status === 200 ? Promise.resolve('') : upload.text())}`,
)
const asset = await upload.json()
assert.ok(asset.id)
results.push('uploadAsset')
await rpc(
  'updateAssetFn',
  { id: asset.id, altText: 'Saved preflight description' },
  (v) => v?.altText === 'Saved preflight description',
)
const file = await fetch(`${config.base}/api/assets/file/${asset.storageKey}`, {
  headers: { Cookie: user.cookie },
})
assert.equal(file.status, 200)
assert.ok((await file.arrayBuffer()).byteLength > 1000)
results.push('assetFile')
await rpc('deleteAssetFn', { id: asset.id }, (v) => v?.ok === true)
user = config.users.find((u) => u.role === 'admin')
await rpc(
  'getMeFn',
  {},
  (v) =>
    v?.user?.isAgencyAdmin &&
    !v?.mfaVerificationRequired &&
    !v?.mfaEnrolmentRequired,
)
await rpc('listOrganizationsFn', {}, Array.isArray)
await rpc('listSitesFn', { organizationId: user.organizationId }, Array.isArray)
const org = await rpc(
  'createOrganizationFn',
  { name: 'Benchmark preflight client', slug: `${slug}-client` },
  (v) => Boolean(v?.id),
)
const site = await rpc(
  'createSiteFn',
  {
    organizationId: org.id,
    name: 'Benchmark preflight site',
    slug: `${slug}-site`,
    productionUrl: 'https://example.invalid',
  },
  (v) => Boolean(v?.id),
)
await rpc(
  'upsertCollectionFn',
  {
    siteId: site.id,
    key: 'articles',
    label: 'Articles',
    routePattern: '/articles/$slug',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
    ],
  },
  (v) => Boolean(v?.id),
)
await rpc('deleteSiteFn', { id: site.id }, (v) => v?.ok === true)
await rpc('deleteOrganizationFn', { id: org.id }, (v) => v?.ok === true)
// Verify seeded credentials really support password login for a non-admin.
user = config.users.find((u) => u.role === 'editor')
const login = await fetch(`${config.base}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: config.base },
  body: JSON.stringify({ email: user.email, password: config.password }),
})
assert.equal(login.status, 200, 'Seeded password login failed')
const loginData = await login.json()
assert.equal(loginData.user?.id, user.id)
assert.ok(login.headers.get('set-cookie'))
results.push('passwordLogin')
await writeFile(
  new URL('preflight.json', dir),
  JSON.stringify(
    { at: new Date().toISOString(), passed: results, imageBytes: image.length },
    null,
    2,
  ),
)
console.log(
  `PASS: ${results.length} sequential functional checks; JPEG ${image.length} bytes. No load test performed.`,
)
