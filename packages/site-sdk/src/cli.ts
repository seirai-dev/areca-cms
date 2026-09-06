#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, usage } from './args.js'
import { createArecaClient } from './client.js'
import { pullContent } from './pull.js'
import type { SiteContentConfig } from './types.js'

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv)

  if (parsed.command === 'help') {
    console.log(usage())
    return 0
  }

  if (parsed.command === 'error') {
    console.error(parsed.message)
    console.error(usage())
    return 1
  }

  try {
    if (parsed.command === 'pull') {
      const snapshot = await pullContent({ outDir: parsed.outDir })
      const counts = Object.entries(snapshot.collections)
        .map(([key, entries]) => `${key}=${entries.length}`)
        .join(', ')
      console.log(
        `Pulled publication ${snapshot.publicationId} (${snapshot.hash})${counts ? `: ${counts}` : ''}`,
      )
      return 0
    }

    const config = await loadConfig(parsed.configPath)
    await createArecaClient().syncManifest(config)
    console.log(`Synced manifest from ${parsed.configPath}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}

async function loadConfig(configPath: string): Promise<SiteContentConfig> {
  const abs = resolve(process.cwd(), configPath)
  let mod: { default?: SiteContentConfig }

  try {
    mod = (await import(pathToFileURL(abs).href)) as { default?: SiteContentConfig }
  } catch (error) {
    if (abs.endsWith('.ts') || abs.endsWith('.mts') || abs.endsWith('.tsx')) {
      throw new Error(
        `Failed to load TypeScript config ${configPath}. Run the CLI via tsx, e.g. pnpm exec tsx ./node_modules/@areca/site-sdk/dist/cli.js sync-manifest ${configPath}`,
      )
    }
    throw error
  }

  if (!mod.default) {
    throw new Error(`Config module ${configPath} has no default export.`)
  }

  return mod.default
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(entry).toLowerCase()
}

if (isMainModule()) {
  void run(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code)
  })
}
