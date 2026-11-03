import { readFile } from 'node:fs/promises'
import { refreshSessions } from './baseline.mjs'
const fixtures = JSON.parse(
  await readFile(new URL('./.local/fixtures.json', import.meta.url)),
)
await refreshSessions(fixtures)
console.log('Refreshed synthetic session expiry and admin freshness proofs')
