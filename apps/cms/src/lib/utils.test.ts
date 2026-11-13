import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'cn/build'
import { createCn } from 'cn/config'
import { describe, expect, it } from 'vitest'
import cnConfig from './cn.config'
import { cn } from './utils'

const cases: Array<Array<string | false | undefined>> = [
  ['px-2', 'px-4'],
  ['text-caption text-text-primary'],
  ['text-text-primary', 'text-caption'],
  ['text-body', 'text-display'],
  ['text-sm', 'text-editor-title'],
  ['text-mono text-text-muted', 'text-title-1'],
  ['shadow-card', 'shadow-float'],
  ['shadow-sm', 'shadow-raise'],
  ['rounded-control', 'rounded-panel'],
  ['rounded-md', 'rounded-thumb'],
  ['bg-accent hover:bg-accent/80', false, 'bg-surface-raised'],
  ['inline-flex items-center gap-2', undefined, 'gap-1.5 md:gap-3'],
]

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('reads the type scale as font sizes, not text colours', () => {
    expect(cn('text-caption text-text-primary')).toBe(
      'text-caption text-text-primary',
    )
    expect(cn('text-body', 'text-display')).toBe('text-display')
  })

  it('merges exactly like the uncompiled config', () => {
    const reference = createCn(cnConfig)
    for (const input of cases) expect(cn(...input)).toBe(reference(...input))
  })

  it('ships tables compiled from cn.config.ts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cn-tables-'))
    try {
      const fresh = await build({
        cwd: path.resolve(import.meta.dirname, '../..'),
        full: true,
        css: false,
        config: 'src/lib/cn.config.ts',
        out: path.join(dir, 'cn-tables.gen.ts'),
      })
      const committed = await readFile(
        path.join(import.meta.dirname, 'cn-tables.gen.ts'),
        'utf8',
      )
      // Run `pnpm cn:tables` when this fails.
      expect(fresh.source).toBe(committed)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
