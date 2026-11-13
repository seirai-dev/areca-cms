import { describe, expect, it } from 'vitest'

import { protectCode, replaceFencedCode } from './translate.ts'

/** The regex replaceFencedCode replaced, kept as the oracle. */
function oracle(text: string, hold: (block: string) => string) {
  return text.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1`*[ \t]*$/gm, hold)
}

function both(text: string) {
  const run = (replace: typeof oracle) => {
    const held: string[] = []
    const out = replace(text, (block) => {
      held.push(block)
      return `<${held.length}>`
    })
    return { out, held }
  }
  return { actual: run(replaceFencedCode), expected: run(oracle) }
}

/** Small deterministic PRNG, so a failure can be replayed from its seed. */
function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  '`',
  '``',
  '```',
  '````',
  '`````',
  '\n',
  '\n',
  '\n',
  ' ',
  '\t',
  'a',
  'ts',
  '\r',
  '\r\n',
  ' ',
  ' ',
  '\\',
  '\n\n',
]

function randomText(next: () => number, length: number) {
  let text = ''
  while (text.length < length) {
    text += PIECES[Math.floor(next() * PIECES.length)]
  }
  return text
}

describe('replaceFencedCode', () => {
  const cases = [
    '',
    '```',
    '```\n```',
    '```\n\n```',
    '```ts\nconst a = 1\n```',
    '```ts\nconst a = 1\n```  \t',
    '```ts\nconst a = 1\n``` x',
    '````\na\n```\nb\n````',
    '````\na\n```\nb',
    '`````\na\n```\nb\n````\nc',
    '```\na\n`````\nb\n```',
    'x```\na\n```',
    'x\n```\na\n```\ny',
    '```\r\na\r\n```\r\n',
    '```\ra\n```\r',
    'a\r```\nb\n```',
    'a ```\nb\n``` c',
    '```\na\n```\n```\nb\n```',
    '```\n```\n```',
    '```a```\nb\n```',
    '```\n```x\n```',
    '```\n  ```\n```',
    '```\na\n```\n',
    '```x\n```x\n```x\n',
    '```\n'.repeat(5),
    '```js\n'.repeat(5) + '```',
  ]

  it.each(cases)('matches the regex for %j', (text) => {
    const { actual, expected } = both(text)
    expect(actual).toEqual(expected)
  })

  it('matches the regex on random input', () => {
    for (let seed = 1; seed <= 4000; seed++) {
      const next = rng(seed)
      const text = randomText(next, 1 + Math.floor(next() * 120))
      const { actual, expected } = both(text)
      expect(actual, `seed ${seed}: ${JSON.stringify(text)}`).toEqual(expected)
    }
  })

  it('stays fast on many unclosed fences', () => {
    const inputs = [
      '```x\n'.repeat(40_000),
      '```\n'.repeat(50_000).slice(0, 200_000),
      '````\na\n'.repeat(33_000) + '```',
      '```\r'.repeat(50_000) + '\n',
    ]
    for (const text of inputs) {
      expect(text.length).toBeGreaterThanOrEqual(190_000)
      const started = performance.now()
      protectCode(text)
      expect(performance.now() - started).toBeLessThan(200)
    }
  })
})
