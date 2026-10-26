import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Skill = {
  name: string
  description: string
  /** Absolute path of the skill folder. */
  dir: string
}

const MARKER = 'areca-sdk/SKILL.md'

/**
 * Where the bundled skills live. Inside the monorepo the root `skills/` folder is
 * the source of truth, so it wins over the `skills/` copy that `build` makes inside
 * the package (that copy can go stale). An npm install has no repo root, so the
 * packaged copy is used.
 *
 * `moduleDir` is the folder of this module (`src/` from source, `dist/` when built).
 * It is a parameter so tests can point it at a temp layout.
 */
export function skillsRoot(moduleDir = dirname(fileURLToPath(import.meta.url))): string {
  const repoRoot = resolve(moduleDir, '../../..')
  const repoSkills = join(repoRoot, 'skills')
  const packaged = resolve(moduleDir, '../skills')
  const inRepo = existsSync(join(repoRoot, 'pnpm-workspace.yaml')) && existsSync(join(repoSkills, MARKER))
  if (inRepo) return repoSkills
  if (existsSync(join(packaged, MARKER))) return packaged
  throw new Error(`Bundled skills not found (looked in ${repoSkills}, ${packaged})`)
}

export function loadSkills(root = skillsRoot()): Skill[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .map((entry) => {
      const dir = join(root, entry.name)
      const meta = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
      return { name: meta.name ?? entry.name, description: meta.description ?? '', dir }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Top-level `key: value` pairs of a SKILL.md frontmatter block. */
export function parseFrontmatter(source: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (!match) return {}
  const out: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (pair && pair[2]) out[pair[1]!] = pair[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/** Every file in a skill folder as [path relative to the folder, contents]. */
export function skillFiles(dir: string): [string, Buffer][] {
  const out: [string, Buffer][] = []
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push([relative(dir, path).split('\\').join('/'), readFileSync(path)])
    }
  }
  walk(dir)
  return out
}
