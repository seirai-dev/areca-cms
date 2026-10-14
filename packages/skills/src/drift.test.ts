import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadSkills, parseFrontmatter, skillFiles } from './skills.js'

/**
 * Keeps the skills honest against the monorepo: every SDK export, CLI command,
 * env var and MCP tool must be documented, and every documented tool must exist.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (path: string) => readFileSync(join(repo, path), 'utf8')
const skillText = (name: string) => {
  const skill = loadSkills(join(repo, 'skills')).find((item) => item.name === name)!
  return skillFiles(skill.dir)
    .map(([, data]) => data.toString('utf8'))
    .join('\n')
}

describe('skill format (agentskills.io spec)', () => {
  for (const skill of loadSkills(join(repo, 'skills'))) {
    it(`${skill.name} is valid`, () => {
      const source = readFileSync(join(skill.dir, 'SKILL.md'), 'utf8')
      const meta = parseFrontmatter(source)
      expect(meta.name).toBe(skill.dir.split(/[\\/]/).at(-1))
      expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(meta.name!.length).toBeLessThanOrEqual(64)
      expect(meta.name).not.toMatch(/claude|anthropic/)
      expect(meta.description!.length).toBeGreaterThan(50)
      expect(meta.description!.length).toBeLessThanOrEqual(1024)
      expect(meta.description).not.toMatch(/[<>]/)
      expect(source.split('\n').length).toBeLessThan(500)
      for (const [, link] of source.matchAll(/\]\(([\w./-]+\.md)\)/g)) {
        expect(existsSync(join(skill.dir, link!)), link).toBe(true)
        expect(link!.split('/').length, `${link} is one level deep`).toBeLessThanOrEqual(2)
      }
    })
  }
})

describe('areca-sdk covers @areca-cms/site-sdk', () => {
  const text = skillText('areca-sdk')
  const sdk = 'packages/site-sdk'

  it('documents every export', () => {
    const names = new Set<string>()
    for (const file of ['index.ts', 'pull.ts', 'seo.ts', 'rich-text.ts', 'rich-text-react.ts']) {
      const source = read(`${sdk}/src/${file}`)
      for (const [, list] of source.matchAll(/export (?:type )?\{([^}]+)\}/g)) {
        for (const name of list!.split(',')) if (name.trim()) names.add(name.trim().split(/\s+as\s+/).at(-1)!)
      }
      for (const [, name] of source.matchAll(/export (?:async )?(?:function|const|type|class) (\w+)/g)) names.add(name!)
    }
    expect([...names].filter((name) => !text.includes(name))).toEqual([])
  })

  it('documents every subpath export', () => {
    const exports = Object.keys(JSON.parse(read(`${sdk}/package.json`)).exports)
    const subpaths = exports.filter((key) => key !== '.' && key !== './package.json')
    expect(subpaths.filter((key) => !text.includes(`@areca-cms/site-sdk/${key.slice(2)}`))).toEqual([])
  })

  it('documents every CLI command and env var', () => {
    const args = read(`${sdk}/src/args.ts`)
    const commands = [...args.matchAll(/command === '([\w-]+)'/g)].map(([, name]) => name!)
    expect(commands.filter((name) => !text.includes(`areca ${name}`))).toEqual([])

    const env = new Set<string>()
    for (const file of readdirSync(join(repo, sdk, 'src'))) {
      if (file.endsWith('.test.ts')) continue
      // Fixture folders such as test-fixtures/ hold no source to scan.
      if (!statSync(join(repo, sdk, 'src', file)).isFile()) continue
      for (const [name] of read(`${sdk}/src/${file}`).matchAll(/ARECA_[A-Z_]+/g)) env.add(name)
    }
    expect([...env].filter((name) => !text.includes(name))).toEqual([])
  })
})

describe('areca-mcp covers the MCP server', () => {
  const text = skillText('areca-mcp')
  const toolsDir = 'apps/cms/src/server/mcp/tools'
  const tools = readdirSync(join(repo, toolsDir))
    .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
    .flatMap((file) => [...read(`${toolsDir}/${file}`).matchAll(/^\s+name: '(\w+)'/gm)].map(([, name]) => name!))
  const prompts = [...read('apps/cms/src/server/mcp/server.ts').matchAll(/registerPrompt\(\s*'(\w+)'/g)].map(
    ([, name]) => name!,
  )

  it('documents every tool and prompt', () => {
    expect(tools.length).toBeGreaterThan(20)
    expect([...tools, ...prompts].filter((name) => !new RegExp(`\`${name}[\`(]`).test(text))).toEqual([])
  })

  it('documents no tools that do not exist', () => {
    const reference = read('skills/areca-mcp/references/tools.md')
    const documented = [...reference.matchAll(/^\| `(\w+)` \|/gm)].map(([, name]) => name!)
    expect(documented.filter((name) => !tools.includes(name))).toEqual([])
  })
})

describe('Claude Code plugin', () => {
  it('matches the package version', () => {
    const plugin = JSON.parse(read('.claude-plugin/plugin.json'))
    const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'))
    const version = JSON.parse(read('packages/skills/package.json')).version
    expect(plugin.version).toBe(version)
    expect(marketplace.plugins.map((entry: { name: string }) => entry.name)).toContain(plugin.name)
    for (const skill of loadSkills(join(repo, 'skills'))) {
      expect(readFileSync(join(skill.dir, 'SKILL.md'), 'utf8')).toContain(`version: "${version}"`)
    }
  })
})
