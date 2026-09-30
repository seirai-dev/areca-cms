// Module resolution hooks registered by ./script-runtime.mjs.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const outdir = new URL(
  '../../node_modules/.cache/areca-scripts/paraglide/',
  import.meta.url,
)
const PREFIX = '#/paraglide/'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(PREFIX)) {
    const rest = specifier.slice(PREFIX.length).replace(/\.js$/, '')
    const target = new URL(`${rest}.js`, outdir)
    if (!existsSync(fileURLToPath(target))) {
      throw new Error(
        `Paraglide messages for scripts are missing (${fileURLToPath(target)}). ` +
          'Run `pnpm paraglide:scripts` first.',
      )
    }
    return { url: pathToFileURL(fileURLToPath(target)).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
