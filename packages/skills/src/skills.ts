import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Skill = {
  name: string
  description: string
  /** Absolute path of the skill folder. */
  dir: string
}

/**
 * Skills ship in the package's `skills/` folder (copied from the repo root at
 * build). From source inside the monorepo, fall back to the repo root copy.
 */
export function skillsRoot(): string {
  const candidates = [
    fileURLToPath(new URL('../skills', import.meta.url)),
    fileURLToPath(new URL('../../../skills', import.meta.url)),
  ]
  const found = candidates.find((dir) => existsSync(join(dir, 'areca-sdk', 'SKILL.md')))
  if (!found) throw new Error(`Bundled skills not found (looked in ${candidates.join(', ')})`)
  return found
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
