import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const require = createRequire(new URL('../package.json', import.meta.url))
const startPackage = realpathSync(
  new URL(
    '../node_modules/@tanstack/react-start/package.json',
    import.meta.url,
  ),
)
const corePackage = realpathSync(
  resolve(dirname(startPackage), '../start-client-core/package.json'),
)
const coreRequire = createRequire(corePackage)
const { build } = require('esbuild')
const root = fileURLToPath(new URL('.', import.meta.url))
await mkdir(`${root}.local`, { recursive: true })
for (const entry of ['wire', 'workload']) {
  await build({
    entryPoints: [`${root}${entry}.js`],
    outfile: `${root}.local/${entry}.mjs`,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['k6', 'k6/*'],
    plugins: [
      {
        name: 'seroval',
        setup(b) {
          b.onResolve({ filter: /^seroval$/ }, () => ({
            path: coreRequire.resolve('seroval'),
          }))
        },
      },
    ],
  })
}
console.log('Built protocol adapter and k6 workload in benchmarks/.local')
