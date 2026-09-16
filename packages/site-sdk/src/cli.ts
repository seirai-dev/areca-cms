#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, usage } from './args.js'
import { createArecaClient } from './client.js'
import { loadLocalEnv } from './env.js'
import { InitCancelledError, initSite } from './init.js'
import { pullContent } from './pull.js'
import type { SiteContentConfig } from './types.js'

type RunOptions = {
  cwd?: string
}

export async function run(argv: string[], options: RunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  loadLocalEnv(cwd)
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
    if (parsed.command === 'run') {
      return await runChild(parsed.commandArgs, cwd)
    }

    if (parsed.command === 'init') {
      await initSite({
        cwd,
        cmsUrl: parsed.cmsUrl,
        token: parsed.token,
        siteKey: parsed.siteKey,
        outDir: parsed.outDir,
        configPath: parsed.configPath,
        yes: parsed.yes,
        force: parsed.force,
      })
      return 0
    }

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

    const config = await loadConfig(parsed.configPath, cwd)
    await createArecaClient().syncManifest(config)
    console.log(`Synced manifest from ${parsed.configPath}`)
    return 0
  } catch (error) {
    if (error instanceof InitCancelledError) {
      return 0
    }
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}

async function runChild(commandArgs: string[], cwd: string): Promise<number> {
  return await new Promise((resolve) => {
    const child = spawn(commandArgs.join(' '), {
      stdio: 'inherit',
      shell: true,
      cwd,
    })
    child.on('close', (code) => {
      resolve(code ?? 1)
    })
    child.on('error', (error) => {
      console.error(error instanceof Error ? error.message : error)
      resolve(1)
    })
  })
}

async function loadConfig(configPath: string, cwd: string): Promise<SiteContentConfig> {
  const abs = resolve(cwd, configPath)
  let mod: { default?: SiteContentConfig }

  try {
    mod = (await import(pathToFileURL(abs).href)) as { default?: SiteContentConfig }
  } catch (error) {
    if (abs.endsWith('.ts') || abs.endsWith('.mts') || abs.endsWith('.tsx')) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to load TypeScript config ${configPath} via native import (${detail}). Retry with tsx, e.g. pnpm exec tsx ./node_modules/@areca-cms/site-sdk/dist/cli.js sync-manifest ${configPath}`,
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
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)).toLowerCase() ===
      realpathSync(entry).toLowerCase()
    )
  } catch {
    return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(entry).toLowerCase()
  }
}

if (isMainModule()) {
  void run(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code)
  })
}
