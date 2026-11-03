import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ssh, app } from './remote.mjs'
if (process.env.BENCH_CPU_PROFILE !== 'YES')
  throw new Error(
    'Set BENCH_CPU_PROFILE=YES only for separate diagnostic replay',
  )
const destination = resolve(
  process.argv[2] ||
    new URL('./.local/cpu-diagnostic', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
)
await mkdir(destination, { recursive: true })
const source = await readFile(
  new URL('./profile-server.cjs', import.meta.url),
  'utf8',
)
const seconds = Number(process.env.BENCH_PROFILE_SECONDS || 30)
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
  throw new Error('BENCH_PROFILE_SECONDS must be 1..60')
const raw = await ssh(
  `docker exec -i -e BENCH_CPU_PROFILE=YES -e BENCH_PROFILE_SECONDS=${seconds} ${app} node --input-type=commonjs`,
  source,
)
const captured = JSON.parse(raw)
await writeFile(
  `${destination}/cpu-profile.cpuprofile`,
  JSON.stringify(captured.profile),
)
delete captured.profile
await writeFile(
  `${destination}/cpu-threads.json`,
  JSON.stringify(captured, null, 2),
)
console.log(
  `Saved ${seconds}-second CMS CPU profile and thread counters to ${destination}`,
)
