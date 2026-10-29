import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

/** Every module reachable from `entry` through value imports and re-exports. */
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const source = readFileSync(join(SRC, entry), 'utf8')
  const pattern = /^(?:import|export)\s+(?!type\b)[^'"]*?from\s+'([^']+)'/gm
  for (const [, specifier] of source.matchAll(pattern)) {
    if (specifier!.startsWith('./')) reachable(specifier!.replace(/\.js$/, '.ts').slice(2), seen)
    else seen.add(specifier!)
  }
  return seen
}

// Sites import these entries from pages that run in the browser, so none of
// them may reach a Node built-in (Vite externalizes those and the page fails to hydrate).
describe.each(['index.ts', 'visual.ts', 'visual-react.ts', 'rich-text.ts', 'rich-text-react.ts', 'seo.ts'])(
  'the %s entry',
  (entry) => {
    it('reaches no node: module', () => {
      const nodeModules = [...reachable(entry)].filter((name) => name.startsWith('node:'))
      expect(nodeModules).toEqual([])
    })
  },
)
