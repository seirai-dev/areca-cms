import { describe, expect, it } from 'vitest'

import { CODE_LANGUAGES } from '#/lib/highlight'
import type { Field } from '#/lib/types'

import { agencyServerInstructions } from './agency-server'
import type { McpActor } from './keys'
import { CODE_FENCE_LANGUAGES, CODE_FORMAT } from './rich-text-guide'
import { serverInstructions } from './server'
import { describeField, exampleValue } from './schema-docs'

const LANGUAGE_IDS = CODE_LANGUAGES.map((language) => language.id).filter(
  (id) => id !== 'plaintext',
)

const actor = {
  siteName: 'Demo site',
  role: 'owner',
  allowGoLive: true,
  credential: 'oauth',
} as Pick<
  McpActor,
  'siteName' | 'role' | 'allowGoLive' | 'credential'
> as McpActor

const body: Field = { key: 'body', label: 'Body', type: 'richtext' }

describe('rich text code guidance', () => {
  it('derives the fence languages from the editor list, without plaintext', () => {
    expect(CODE_FENCE_LANGUAGES).toEqual(LANGUAGE_IDS)
    expect(CODE_FENCE_LANGUAGES).not.toContain('plaintext')
  })

  for (const [name, text] of [
    ['site', () => serverInstructions(actor)],
    ['agency', () => agencyServerInstructions()],
  ] as const) {
    describe(`${name} server instructions`, () => {
      it('say rich text takes inline code and fenced code blocks', () => {
        const instructions = text()
        expect(instructions).toContain('`inline code` in backticks')
        expect(instructions).toContain('fenced code blocks with a language')
        expect(instructions).toContain(
          'Put code, commands, file contents and config in fenced blocks with a language (```ts)',
        )
        expect(instructions).toContain('Never paste code as plain paragraphs.')
      })

      it('list every fence language id and the unknown-language warning', () => {
        const instructions = text()
        expect(instructions).toContain(
          `Fence languages: ${LANGUAGE_IDS.join(', ')}.`,
        )
        expect(instructions).toContain('plaintext for plain text')
        expect(instructions).toContain(
          'saved without colours, and the result lists a warning',
        )
      })
    })
  }

  it('describes richtext fields with the code format', () => {
    const format = describeField(body).format
    expect(format).toContain(CODE_FORMAT)
    expect(format).toContain('Inline code goes in backticks')
    for (const id of LANGUAGE_IDS) expect(format).toContain(id)
  })

  it('example richtext shows inline code and a ts fence', () => {
    const example = exampleValue(body)
    expect(typeof example).toBe('string')
    expect(example).toContain('`inline code`')
    expect(example).toMatch(/^```ts$/m)
    expect(example).toMatch(/^```$/m)
  })
})
