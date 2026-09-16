import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = 'src/generated/content'
const cli = join(pkgRoot, 'node_modules/@areca-cms/site-sdk/dist/cli.js')
const hasCmsEnv = Boolean(
  process.env.ARECA_CMS_URL?.trim() && process.env.ARECA_SITE_TOKEN?.trim(),
)
const hasContent =
  existsSync(join(pkgRoot, outDir, 'manifest.json')) &&
  existsSync(join(pkgRoot, outDir, 'articles.json'))

if (hasCmsEnv) {
  console.log(`Running areca pull --out ${outDir}`)
  const result = spawnSync(process.execPath, [cli, 'pull', '--out', outDir], {
    stdio: 'inherit',
    cwd: pkgRoot,
    env: process.env,
  })
  process.exit(result.status ?? 1)
}

if (hasContent) {
  console.log(
    `Skipping areca pull (ARECA_CMS_URL / ARECA_SITE_TOKEN unset). Using ${outDir}`,
  )
  process.exit(0)
}

console.error(
  'No published content. Set ARECA_CMS_URL and ARECA_SITE_TOKEN, then `areca pull --out src/generated/content`, or run `pnpm content:fixture`.',
)
process.exit(1)
