import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paraglideWarnings } from './paraglide.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

/** A project root, optionally with a Paraglide settings file. */
function project(settings?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'areca-paraglide-'))
  directories.push(dir)
  if (settings !== undefined) {
    mkdirSync(join(dir, 'project.inlang'))
    writeFileSync(join(dir, 'project.inlang', 'settings.json'), settings)
  }
  return dir
}

const languages = { main: 'nl', all: ['nl', 'en'] }

describe('paraglideWarnings', () => {
  it('returns nothing without a Paraglide settings file', () => {
    expect(paraglideWarnings(project(), languages)).toEqual([])
  })

  it('returns nothing when the CMS has no languages', () => {
    expect(paraglideWarnings(project('{"baseLocale":"en","locales":["en"]}'), undefined)).toEqual([])
  })

  it('returns nothing when base locale and locales match', () => {
    const dir = project('{"baseLocale":"nl","locales":["nl","en"]}')
    expect(paraglideWarnings(dir, languages)).toEqual([])
  })

  it('warns when the base locale differs from the CMS main language', () => {
    const dir = project('{"baseLocale":"en","locales":["en","nl"]}')
    expect(paraglideWarnings(dir, languages)).toEqual([
      'Paraglide base locale is en but the CMS main language is nl',
    ])
  })

  it('warns when the locale lists differ', () => {
    const dir = project('{"baseLocale":"nl","locales":["nl","de"]}')
    expect(paraglideWarnings(dir, languages)).toEqual([
      'Paraglide locales (nl, de) do not match the CMS languages (nl, en)',
    ])
  })

  it('does not fail on a settings file that is not valid JSON', () => {
    const warnings = paraglideWarnings(project('{not json'), languages)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^Could not read project\.inlang\/settings\.json/)
  })
})
