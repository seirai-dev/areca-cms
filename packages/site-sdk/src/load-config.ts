import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SiteContentConfig } from './types.js'

let loads = 0

/** Imports an areca.config.ts (or .js) module and returns its default export. */
export async function loadConfig(
  configPath: string,
  cwd: string = process.cwd(),
): Promise<SiteContentConfig> {
  const abs = resolve(cwd, configPath)
  let mod: { default?: SiteContentConfig }

  try {
    // A fresh query string per load: ESM caches by URL, and a second load in the
    // same process (a test, a watcher) must see the file as it is now.
    mod = (await import(`${pathToFileURL(abs).href}?load=${++loads}`)) as {
      default?: SiteContentConfig
    }
  } catch (error) {
    if (abs.endsWith('.ts') || abs.endsWith('.mts') || abs.endsWith('.tsx')) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to load TypeScript config ${configPath} via native import (${detail}). Use Node.js 22.18 or newer, or retry with tsx, e.g. pnpm exec tsx ./node_modules/@areca-cms/site-sdk/dist/cli.js <command>`,
      )
    }
    throw error
  }

  if (!mod.default) {
    throw new Error(`Config module ${configPath} has no default export.`)
  }

  return mod.default
}
