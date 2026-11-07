import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The messages behind the Go live link warnings and the push warnings for
 * cleared links, in English, Dutch and Turkish. Each language has every key,
 * and the same placeholders as English, so no translated text shows `{target}`.
 */
const KEYS = [
  'golive_links_title_one',
  'golive_links_title_many',
  'golive_links_hint',
  'golive_link_reason_not_live',
  'golive_link_reason_missing',
  'golive_link_reason_section',
  'dev_push_warning_link_cleared',
  'dev_push_warning_link_cleared_locale',
]

const messagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../messages',
)
const load = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8'))

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe('go live link warning messages', () => {
  const english = load('en')

  it.each(['nl', 'tr'])(
    'has every key in %s with the English placeholders',
    (locale) => {
      const messages = load(locale)
      for (const key of KEYS) {
        expect(messages[key], `${locale}: ${key}`).toBeTruthy()
        expect(placeholders(messages[key]), `${locale}: ${key}`).toEqual(
          placeholders(english[key]),
        )
      }
    },
  )

  it('has every key in English', () => {
    for (const key of KEYS) expect(english[key], key).toBeTruthy()
  })
})
