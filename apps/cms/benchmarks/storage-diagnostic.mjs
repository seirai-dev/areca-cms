import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ssh, app } from './remote.mjs'
if (process.env.BENCH_STORAGE_CHECK !== 'YES')
  throw new Error(
    'Set BENCH_STORAGE_CHECK=YES only after capacity traffic has stopped',
  )
const storage = process.env.BENCH_STORAGE_CONTAINER
if (!storage)
  throw new Error('Set BENCH_STORAGE_CONTAINER to the RustFS container')
if (!/^[a-zA-Z0-9_.-]+$/.test(storage))
  throw new Error('Invalid storage container name')
const networks = JSON.parse(
  `[${(await ssh(`docker inspect --format '{{json .NetworkSettings.Networks}}' ${app} ${storage}`)).trim().split('\n').join(',')}]`,
)
const common = Object.keys(networks[0]).find(
  (name) => networks[1][name]?.IPAddress,
)
if (!common) throw new Error('CMS and RustFS have no shared Docker network')
const ip = networks[1][common].IPAddress
if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip))
  throw new Error('Expected an internal IPv4 address')
const require = createRequire(new URL('../package.json', import.meta.url))
const { build } = require('esbuild')
const root = fileURLToPath(new URL('.', import.meta.url))
await mkdir(`${root}/.local`, { recursive: true })
await build({
  entryPoints: [`${root}/storage-check.mjs`],
  outfile: `${root}/.local/storage-check.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
})
const source = await readFile(`${root}/.local/storage-check.cjs`, 'utf8')
const output = await ssh(
  `docker exec -i -e BENCH_STORAGE_CHECK=YES -e BENCH_INTERNAL_S3=http://${ip}:9000 ${app} node --input-type=commonjs`,
  source,
)
const result = JSON.parse(output)
const destination = resolve(
  process.argv[2] || `${root}/.local/storage-diagnostic.json`,
)
await writeFile(destination, JSON.stringify(result, null, 2))
console.log(`Saved storage microcheck to ${destination}`)
