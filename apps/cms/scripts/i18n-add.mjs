#!/usr/bin/env node
/**
 * Merge UI message keys into every locale file in one atomic step, so several
 * people (or agents) can add strings in parallel without clobbering each other.
 *
 * Usage:
 *   node scripts/i18n-add.mjs keys.json          # {"key": "English text", ...}
 *   node scripts/i18n-add.mjs keys.json --force  # overwrite existing keys
 *   node scripts/i18n-add.mjs --remove key1 key2 # delete keys from all locales
 *
 * English is written to en.json. Other locales receive the English text as a
 * placeholder unless they already have a value (translations come later).
 * Keys are kept sorted, `$schema` stays first.
 */
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const messagesDir = join(root, 'messages')
const locales = JSON.parse(
  readFileSync(join(root, 'project.inlang', 'settings.json'), 'utf8'),
).locales
const base = 'en'

const args = process.argv.slice(2)
const force = args.includes('--force')
const remove = args.includes('--remove')
const positional = args.filter((arg) => !arg.startsWith('--'))

function withLock(fn) {
  const lock = join(messagesDir, '.i18n.lock')
  const started = Date.now()
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'))
      break
    } catch {
      if (Date.now() - started > 10_000) rmSync(lock, { force: true })
    }
  }
  try {
    fn()
  } finally {
    rmSync(lock, { force: true })
  }
}

function sorted(messages) {
  const { $schema, ...rest } = messages
  const out = $schema ? { $schema } : {}
  for (const key of Object.keys(rest).sort()) out[key] = rest[key]
  return out
}

function write(file, messages) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(sorted(messages), null, 2)}\n`)
  renameSync(tmp, file)
}

withLock(() => {
  if (remove) {
    for (const locale of locales) {
      const file = join(messagesDir, `${locale}.json`)
      const messages = JSON.parse(readFileSync(file, 'utf8'))
      for (const key of positional) delete messages[key]
      write(file, messages)
    }
    console.log(`Removed ${positional.length} key(s) from ${locales.join(', ')}`)
    return
  }

  if (positional.length !== 1) {
    console.error('Usage: node scripts/i18n-add.mjs keys.json [--force]')
    process.exit(1)
  }
  const additions = JSON.parse(readFileSync(positional[0], 'utf8'))
  let added = 0
  let skipped = 0
  for (const locale of locales) {
    const file = join(messagesDir, `${locale}.json`)
    const messages = JSON.parse(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(additions)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid message key "${key}" (use snake_case)`)
      }
      const exists = key in messages
      if (locale === base) {
        if (exists && !force && messages[key] !== value) {
          skipped++
          console.warn(`skip ${key}: exists with different text (use --force)`)
          continue
        }
        if (!exists) added++
        messages[key] = value
      } else if (!exists || force) {
        messages[key] = value
      }
    }
    write(file, messages)
  }
  console.log(`Added ${added} key(s) to ${locales.join(', ')}; skipped ${skipped}`)
})
