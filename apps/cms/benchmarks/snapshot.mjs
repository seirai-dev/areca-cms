import { readFile, writeFile } from 'node:fs/promises'
import { ssh } from './remote.mjs'
if (process.env.ARECA_BENCHMARK !== '1')
  throw new Error('Set ARECA_BENCHMARK=1')
const fixturePath = new URL('./.local/fixtures.json', import.meta.url)
const fixtures = JSON.parse(await readFile(fixturePath))
const { prefix } = fixtures
if (!/^load-[a-z0-9]+$/.test(prefix)) throw new Error('Invalid fixture prefix')
const snapshot = `/tmp/areca-${prefix}-${Date.now().toString(36)}.dump`
await ssh(
  `umask 077; db=$(docker ps --filter ancestor=postgres:18 --format '{{.Names}}'); test -n "$db" && docker exec "$db" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ${snapshot}.tmp && test -s ${snapshot}.tmp && mv ${snapshot}.tmp ${snapshot}`,
)
fixtures.baselinePath = snapshot
await writeFile(fixturePath, JSON.stringify(fixtures), { mode: 0o600 })
console.log(
  `Fresh baseline database snapshot saved privately on VPS: ${snapshot}`,
)
