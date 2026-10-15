import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SiteLanguages } from './types.js'

/**
 * Warnings for a Paraglide project whose languages differ from the CMS. Reads
 * `project.inlang/settings.json` under `cwd`, if it exists. Never throws: a
 * settings file that cannot be read is itself a warning.
 */
export function paraglideWarnings(
  cwd: string,
  languages: SiteLanguages | null | undefined,
): string[] {
  if (!languages) return []
  const path = join(cwd, 'project.inlang', 'settings.json')
  if (!existsSync(path)) return []

  let settings: { baseLocale?: unknown; locales?: unknown }
  try {
    settings = JSON.parse(readFileSync(path, 'utf8')) as typeof settings
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [`Could not read project.inlang/settings.json: ${detail}`]
  }

  const warnings: string[] = []
  if (typeof settings.baseLocale === 'string' && !sameTag(settings.baseLocale, languages.main)) {
    warnings.push(
      `Paraglide base locale is ${settings.baseLocale} but the CMS main language is ${languages.main}`,
    )
  }
  if (Array.isArray(settings.locales)) {
    const locales = settings.locales.filter((tag): tag is string => typeof tag === 'string')
    const cms = new Set(languages.all.map(lower))
    const paraglide = new Set(locales.map(lower))
    const match = cms.size === paraglide.size && [...cms].every((tag) => paraglide.has(tag))
    if (!match) {
      warnings.push(
        `Paraglide locales (${locales.join(', ')}) do not match the CMS languages (${languages.all.join(', ')})`,
      )
    }
  }
  return warnings
}

function lower(tag: string): string {
  return tag.toLowerCase()
}

function sameTag(a: string, b: string): boolean {
  return lower(a) === lower(b)
}
