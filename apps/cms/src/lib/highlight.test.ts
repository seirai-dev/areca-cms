import { describe, expect, it } from 'vitest'
import { normalizeLanguage } from '@tanstack/highlight'

import {
  CODE_LANGUAGES,
  codeHighlighter,
  isSupportedCodeLanguage,
  normalizeCodeLanguage,
} from './highlight'

describe('CODE_LANGUAGES', () => {
  it('lists the 17 supported ids in picker order, each registered', () => {
    expect(CODE_LANGUAGES.map((language) => language.id)).toEqual([
      'plaintext',
      'ts',
      'tsx',
      'js',
      'jsx',
      'html',
      'css',
      'json',
      'shell',
      'python',
      'php',
      'sql',
      'yaml',
      'markdown',
      'go',
      'rust',
      'diff',
    ])
    expect([...codeHighlighter.listLanguages()].sort()).toEqual(
      CODE_LANGUAGES.map((language) => language.id).sort(),
    )
  })
})

describe('normalizeCodeLanguage', () => {
  it.each([
    ['bash', 'shell'],
    ['sh', 'shell'],
    ['zsh', 'shell'],
    ['shell-session', 'shell'],
    ['typescript', 'ts'],
    ['javascript', 'js'],
    ['node', 'js'],
    ['yml', 'yaml'],
    ['py', 'python'],
    ['md', 'markdown'],
    ['htm', 'html'],
    ['patch', 'diff'],
    ['golang', 'go'],
    ['rs', 'rust'],
    ['TS', 'ts'],
    ['  Python  ', 'python'],
    ['tsx', 'tsx'],
  ])('maps %j to %j', (raw, expected) => {
    expect(normalizeCodeLanguage(raw)).toBe(expected)
  })

  it.each(['', '   ', 'plaintext', 'text', 'txt', 'plain', undefined, null])(
    'treats %j as plain text',
    (raw) => {
      expect(normalizeCodeLanguage(raw)).toBeUndefined()
    },
  )

  it('keeps an unknown language, trimmed and otherwise as written', () => {
    expect(normalizeCodeLanguage('  COBOL ')).toBe('COBOL')
    expect(normalizeCodeLanguage('elixir')).toBe('elixir')
    expect(isSupportedCodeLanguage('elixir')).toBe(false)
    expect(isSupportedCodeLanguage('ts')).toBe(true)
  })

  it('agrees with the full package for every alias it maps', () => {
    // The root entry bundles every grammar, so it is only used here to cross-check.
    for (const alias of ['bash', 'typescript', 'yml', 'py', 'md', 'golang']) {
      expect(normalizeCodeLanguage(alias)).toBe(normalizeLanguage(alias))
    }
  })
})
