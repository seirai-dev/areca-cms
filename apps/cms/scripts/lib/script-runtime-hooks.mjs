// Module resolution hooks registered by ./script-runtime.mjs.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const outdir = new URL(
  '../../node_modules/.cache/areca-scripts/paraglide/',
  import.meta.url,
)
const appdir = new URL('../../src/paraglide/', import.meta.url)
const PREFIX = '#/paraglide/'
export async function resolve(specifier, context, nextResolve) {
  let rest
  if (specifier.startsWith(PREFIX)) rest = specifier.slice(PREFIX.length)
  else {
    // tsx may resolve the package alias before this hook sees the request.
    const absolute = new URL(specifier, context.parentURL ?? import.meta.url)
    if (absolute.href.startsWith(appdir.href))
      rest = absolute.href.slice(appdir.href.length)
  }
  if (rest !== undefined) {
    const target = new URL(`${rest.replace(/\.js$/, '')}.js`, outdir)
    if (!existsSync(fileURLToPath(target)))
      throw new Error(
        `Paraglide messages for scripts are missing (${fileURLToPath(target)}). Run pnpm run paraglide:scripts first.`,
      )
    return { url: target.href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
