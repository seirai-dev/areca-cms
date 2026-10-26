#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG_PATH, parseArgs, usage } from './args.js'
import { resolveAssetsConfig } from './assets.js'
import { camelCollectionKeys } from './camel-case.js'
import { createArecaClient } from './client.js'
import { loadLocalEnv } from './env.js'
import { InitCancelledError, initSite } from './init.js'
import { loadConfig } from './load-config.js'
import { ManifestPullCancelledError, manifestPull } from './manifest-pull.js'
import { pushManifest } from './manifest-push.js'
import { paraglideWarnings } from './paraglide.js'
import { pullContent } from './pull.js'

type RunOptions = {
  cwd?: string
}

export async function run(
  argv: string[],
  options: RunOptions = {},
): Promise<number> {
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
        assetsDir: parsed.assetsDir,
        assetsPublicPath: parsed.assetsPublicPath,
        noAssets: parsed.noAssets,
      })
      return 0
    }

    if (parsed.command === 'pull') {
      // Without a config file the defaults apply (media in public/areca).
      const configPath = parsed.configPath ?? DEFAULT_CONFIG_PATH
      const config =
        parsed.configPath !== undefined || existsSync(resolve(cwd, configPath))
          ? await loadConfig(configPath, cwd)
          : undefined
      const assets = resolveAssetsConfig(config?.assets, cwd)
      const snapshot = await pullContent({
        outDir: resolve(cwd, parsed.outDir),
        contentDir: parsed.outDir,
        publicationId: parsed.publicationId,
        ...(parsed.typesPath ? { types: resolve(cwd, parsed.typesPath) } : {}),
        ...(assets ? { assets } : {}),
        ...(config?.i18n?.paraglide ? { paraglide: resolve(cwd, config.i18n.paraglide) } : {}),
      })
      // Print camelCase keys, the names used in the pulled files and in code.
      const camelKeys = camelCollectionKeys(Object.keys(snapshot.collections))
      const counts = Object.entries(snapshot.collections)
        .map(([key, entries]) => `${camelKeys.get(key)}=${entries.length}`)
        .join(', ')
      console.log(
        `Pulled publication ${snapshot.publicationId} (${snapshot.hash})${counts ? `: ${counts}` : ''}`,
      )
      if (snapshot.localAssets) {
        const { total, downloaded, dir } = snapshot.localAssets
        console.log(
          `Media: ${total} file(s) in ${relative(cwd, dir) || '.'} (${downloaded} downloaded)`,
        )
      }
      console.log(`Types: ${relative(cwd, snapshot.typesPath) || snapshot.typesPath}`)
      for (const warning of snapshot.warnings) console.warn(`Warning: ${warning}`)
      for (const warning of paraglideWarnings(cwd, snapshot.languages)) {
        console.warn(`Warning: ${warning}`)
      }
      return 0
    }

    if (parsed.command === 'manifest-pull') {
      const result = await manifestPull({
        cwd,
        configPath: parsed.configPath,
        yes: parsed.yes,
      })
      if (result.unchanged) {
        console.log(`${result.configPath} is already up to date`)
        return 0
      }
      const { added, changed, removed } = result.diff
      console.log(
        `Wrote ${result.configPath} with ${result.collections} collection(s) (+${added.length} ~${changed.length} -${removed.length})`,
      )
      return 0
    }

    const config = await loadConfig(parsed.configPath, cwd)
    await pushManifest({
      config,
      client: createArecaClient(),
      confirmDropFields: parsed.confirmDropFields,
      yes: parsed.yes,
    })
    console.log(`Synced manifest from ${parsed.configPath}`)
    return 0
  } catch (error) {
    if (error instanceof InitCancelledError) {
      return 0
    }
    if (error instanceof ManifestPullCancelledError) {
      console.log('Aborted')
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

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)).toLowerCase() ===
      realpathSync(entry).toLowerCase()
    )
  } catch {
    return (
      resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
      resolve(entry).toLowerCase()
    )
  }
}

if (isMainModule()) {
  void run(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code)
  })
}
