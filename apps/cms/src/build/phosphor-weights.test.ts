import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseAst } from 'vite'
import { describe, expect, it } from 'vitest'
import { stripIconWeights } from './phosphor-weights'

const require = createRequire(import.meta.url)
const defsDir = path.join(
  path.dirname(require.resolve('@phosphor-icons/react')),
  'defs',
)

function weightsOf(code: string) {
  return [...code.matchAll(/\n {2}\[\n {4}"(\w+)",/g)].map((match) => match[1])
}

describe('stripIconWeights', () => {
  it('keeps the weights the app uses in every icon definition', () => {
    const files = readdirSync(defsDir).filter((file) => file.endsWith('.es.js'))
    expect(files.length).toBeGreaterThan(1000)
    for (const file of files) {
      const stripped = stripIconWeights(
        readFileSync(path.join(defsDir, file), 'utf8'),
      )
      expect(weightsOf(stripped), file).toEqual([
        'bold',
        'duotone',
        'fill',
        'regular',
      ])
    }
  })

  it('leaves valid JavaScript', () => {
    const stripped = stripIconWeights(
      readFileSync(path.join(defsDir, 'Gear.es.js'), 'utf8'),
    )
    expect(() => parseAst(stripped)).not.toThrow()
    expect(stripped).toContain('export {')
  })

  it('removes only weights the app never asks for', () => {
    const srcDir = path.resolve(import.meta.dirname, '..')
    const sources = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file) && !file.startsWith('build'))
      .map((file) => readFileSync(path.join(srcDir, file), 'utf8'))
    for (const source of sources) {
      expect(source).not.toMatch(/weight\s*[=:]\s*\{?\s*['"](thin|light)['"]/)
    }
  })

  it('returns other code unchanged', () => {
    const code = 'export const x = new Map([["a", 1]]);'
    expect(stripIconWeights(code)).toBe(code)
  })
})
