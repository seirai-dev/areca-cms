import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Every UI string lives in all three locales (docs/DESIGN.md, i18n rules). */
const LOCALES = ['en', 'nl', 'tr'] as const

function load(locale: string): Record<string, string> {
  const file = fileURLToPath(
    new URL(`../../messages/${locale}.json`, import.meta.url),
  )
  const { $schema: _schema, ...messages } = JSON.parse(
    readFileSync(file, 'utf8'),
  ) as Record<string, string>
  return messages
}

const messages = Object.fromEntries(
  LOCALES.map((locale) => [locale, load(locale)]),
) as Record<(typeof LOCALES)[number], Record<string, string>>

/** `{name}` style parameters used by a message. */
function params(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe('message catalogues', () => {
  it('en, nl and tr have identical key sets', () => {
    const en = Object.keys(messages.en).sort()
    expect(en.length).toBeGreaterThan(0)
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(en)
    }
  })

  it('every message is a non-empty string', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(
          typeof value === 'string' && value.trim() !== '',
          `${locale}.${key}`,
        ).toBe(true)
      }
    }
  })

  it('translations use the same parameters as English', () => {
    for (const [key, text] of Object.entries(messages.en)) {
      for (const locale of LOCALES) {
        expect(params(messages[locale][key] ?? ''), `${locale}.${key}`).toEqual(
          params(text),
        )
      }
    }
  })
})
