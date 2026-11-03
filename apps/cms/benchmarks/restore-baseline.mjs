import { readFile } from 'node:fs/promises'
import { restoreBaseline } from './baseline.mjs'
if (process.env.ARECA_BENCHMARK !== '1')
  throw new Error('Set ARECA_BENCHMARK=1')
await restoreBaseline(
  JSON.parse(
    await readFile(new URL('./.local/fixtures.json', import.meta.url)),
  ),
)
console.log('Restored private baseline and verified CMS health')
