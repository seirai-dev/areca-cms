import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { ssh, app, service } from './remote.mjs'
import { discoverRpcManifest } from './rpc-manifest.mjs'
const base = process.env.BENCH_URL
if (!base || new URL(base).protocol !== 'https:')
  throw new Error('Set BENCH_URL to the approved HTTPS deployment')
const dir = new URL('./.local/', import.meta.url),
  fixtures = JSON.parse(await readFile(new URL('fixtures.json', dir)))
const archive = new URL(`archives/${Date.now().toString(36)}/`, dir)
await mkdir(archive, { recursive: true })
for (const name of [
  'fixtures.json',
  'manifest.json',
  'config.json',
  'preflight.json',
])
  try {
    await copyFile(new URL(name, dir), new URL(name, archive))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
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
])
  if (!manifest[name]) throw new Error(`Cannot discover deployed RPC ${name}`)
fixtures.base = base.replace(/\/$/, '')
fixtures.image = (
  await ssh(`docker inspect --format '{{.Config.Image}}' ${app}`)
).trim()
fixtures.imageId = (
  await ssh(`docker inspect --format '{{.Image}}' ${app}`)
).trim()
fixtures.service = service
fixtures.refreshedAt = new Date().toISOString()
await writeFile(
  new URL('manifest.json', dir),
  JSON.stringify(manifest, null, 2),
)
await writeFile(new URL('fixtures.json', dir), JSON.stringify(fixtures), {
  mode: 0o600,
})
await writeFile(
  new URL('config.json', dir),
  JSON.stringify({ base: fixtures.base, prefix: fixtures.prefix }),
)
console.log(
  JSON.stringify(
    {
      base: fixtures.base,
      image: fixtures.image,
      imageId: fixtures.imageId,
      service,
      functions: Object.keys(manifest).sort(),
      users: fixtures.users.length,
    },
    null,
    2,
  ),
)
