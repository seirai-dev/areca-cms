import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { AGENTS, mcpServerName, validateConnectorUrl } from './agents.js'
import { run } from './cli.js'
import { exportZips, installSkills, removeSkills, resolveTargets } from './install.js'
import { configureMcp } from './mcp-config.js'
import { loadSkills, skillsRoot } from './skills.js'
import { createZip } from './zip.js'

const URL_ = 'https://cms.example.com/api/mcp/acme-site'
const tmp = () => mkdtempSync(join(tmpdir(), 'areca-skills-'))
const byId = (...ids: string[]) => ids.map((id) => AGENTS.find((agent) => agent.id === id)!)
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

/** Reads back entries written by createZip (no data descriptors, deflate only). */
function unzip(buffer: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength
    out[name] = inflateRawSync(buffer.subarray(start, start + size)).toString('utf8')
    offset = start + size
  }
  return out
}

describe('skillsRoot', () => {
  const writeSkill = (dir: string, body = 'x') => {
    mkdirSync(join(dir, 'areca-sdk'), { recursive: true })
    writeFileSync(join(dir, 'areca-sdk/SKILL.md'), body)
  }

  it('prefers the repo root skills/ over the packaged copy inside the monorepo', () => {
    const repo = tmp()
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    writeSkill(join(repo, 'skills'), 'fresh')
    const pkg = join(repo, 'packages/skills')
    writeSkill(join(pkg, 'skills'), 'stale')
    mkdirSync(join(pkg, 'src'), { recursive: true })

    const root = skillsRoot(join(pkg, 'src'))
    expect(root).toBe(join(repo, 'skills'))
    expect(readFileSync(join(root, 'areca-sdk/SKILL.md'), 'utf8')).toBe('fresh')
  })

  it('uses the packaged copy when installed from npm (no repo root)', () => {
    const nodeModules = tmp()
    const pkg = join(nodeModules, '@areca-cms/skills')
    writeSkill(join(pkg, 'skills'), 'packaged')
    mkdirSync(join(pkg, 'dist'), { recursive: true })

    const root = skillsRoot(join(pkg, 'dist'))
    expect(root).toBe(join(pkg, 'skills'))
    expect(loadSkills(root).map((skill) => skill.name)).toEqual(['areca-sdk'])
  })

  it('ignores a skills/ folder next to the package when there is no workspace marker', () => {
    const parent = tmp()
    writeSkill(join(parent, 'skills'), 'not-the-repo')
    const pkg = join(parent, 'pkg')
    writeSkill(join(pkg, 'skills'), 'packaged')
    mkdirSync(join(pkg, 'dist'), { recursive: true })

    expect(skillsRoot(join(pkg, 'dist'))).toBe(join(pkg, 'skills'))
  })

  it('throws when no bundled skills exist', () => {
    const empty = tmp()
    mkdirSync(join(empty, 'a/b/c'), { recursive: true })
    expect(() => skillsRoot(join(empty, 'a/b/c'))).toThrow('Bundled skills not found')
  })
})

describe('agents', () => {
  it('has unique ids and a skills folder for every coding agent', () => {
    expect(new Set(AGENTS.map((agent) => agent.id)).size).toBe(AGENTS.length)
    for (const agent of AGENTS.filter((item) => item.group !== 'chat')) {
      expect(agent.projectDir, agent.id).toMatch(/^\.?[\w.-]+(\/[\w.-]+)*\/skills$/)
      expect(agent.globalDir, agent.id).toBeTruthy()
    }
  })

  it('derives the server name like the CMS and validates connector URLs', () => {
    expect(mcpServerName(URL_)).toBe('areca-acme-site')
    expect(validateConnectorUrl(URL_)).toBeUndefined()
    expect(validateConnectorUrl('https://cms.example.com/api/mcp')).toBeTruthy()
    expect(validateConnectorUrl('nope')).toBeTruthy()
  })
})

describe('install', () => {
  it('writes shared folders once and removes only Areca skills', () => {
    const cwd = tmp()
    const targets = resolveTargets(byId('claude-code', 'codex', 'cursor', 'gemini-cli'), 'project', cwd)
    expect(targets.map((target) => target.label)).toEqual(['.claude/skills', '.agents/skills'])

    mkdirSync(join(cwd, '.agents/skills/other'), { recursive: true })
    installSkills(loadSkills(), targets)
    expect(existsSync(join(cwd, '.claude/skills/areca-sdk/SKILL.md'))).toBe(true)
    expect(existsSync(join(cwd, '.agents/skills/areca-mcp/references/tools.md'))).toBe(true)

    removeSkills(['areca-sdk', 'areca-mcp'], targets)
    expect(existsSync(join(cwd, '.agents/skills/areca-sdk'))).toBe(false)
    expect(existsSync(join(cwd, '.agents/skills/other'))).toBe(true)
  })

  it('resolves global folders under the home directory', () => {
    const [target] = resolveTargets(byId('claude-code'), 'global', '/repo', '/home/me')
    expect(target).toMatchObject({ dir: join('/home/me', '.claude/skills'), label: '~/.claude/skills' })
  })

  it('exports zips with the skill folder at the root', () => {
    const out = tmp()
    const [file] = exportZips(loadSkills().filter((skill) => skill.name === 'areca-sdk'), out)
    const entries = unzip(readFileSync(file!))
    expect(Object.keys(entries)).toContain('areca-sdk/SKILL.md')
    expect(entries['areca-sdk/SKILL.md']).toMatch(/^---\nname: areca-sdk\n/)
  })

  it('creates byte-identical zips for the same input', () => {
    const entries = [{ path: 'a/b.txt', data: Buffer.from('hello') }]
    expect(createZip(entries).equals(createZip(entries))).toBe(true)
  })
})

describe('mcp config', () => {
  it('merges into existing JSON and keeps other servers', () => {
    const cwd = tmp()
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { other: { url: 'x' } }, extra: 1 }))
    const results = configureMcp(byId('claude-code', 'github-copilot'), URL_, 'areca-acme-site', cwd)
    expect(results.map((result) => result.status)).toEqual(['written', 'written'])
    expect(readJson(join(cwd, '.mcp.json'))).toEqual({
      mcpServers: { other: { url: 'x' }, 'areca-acme-site': { type: 'http', url: URL_ } },
      extra: 1,
    })
    expect(readJson(join(cwd, '.vscode/mcp.json')).servers['areca-acme-site']).toEqual({ type: 'http', url: URL_ })
    expect(configureMcp(byId('claude-code'), URL_, 'areca-acme-site', cwd)[0]!.status).toBe('unchanged')
  })

  it('leaves JSON with comments alone and returns a snippet', () => {
    const cwd = tmp()
    mkdirSync(join(cwd, '.cursor'))
    writeFileSync(join(cwd, '.cursor/mcp.json'), '{ // mine\n}')
    const [result] = configureMcp(byId('cursor'), URL_, 'areca-acme-site', cwd)
    expect(result).toMatchObject({ status: 'manual', where: '.cursor/mcp.json' })
    expect(readFileSync(join(cwd, '.cursor/mcp.json'), 'utf8')).toBe('{ // mine\n}')
  })

  it('appends a Codex TOML section once', () => {
    const cwd = tmp()
    mkdirSync(join(cwd, '.codex'))
    writeFileSync(join(cwd, '.codex/config.toml'), 'model = "x"')
    configureMcp(byId('codex'), URL_, 'areca-acme-site', cwd)
    configureMcp(byId('codex'), URL_, 'areca-acme-site', cwd)
    expect(readFileSync(join(cwd, '.codex/config.toml'), 'utf8')).toBe(
      `model = "x"\n\n[mcp_servers.areca-acme-site]\nurl = "${URL_}"\n`,
    )
  })

  it('writes Continue YAML and returns snippets for global-only agents', () => {
    const cwd = tmp()
    const results = configureMcp(byId('continue', 'windsurf'), URL_, 'areca-acme-site', cwd)
    expect(readFileSync(join(cwd, '.continue/mcpServers/areca-acme-site.yaml'), 'utf8')).toContain(`url: ${URL_}`)
    expect(results[1]).toMatchObject({ status: 'manual', where: '~/.codeium/windsurf/mcp_config.json' })
  })

  it('only describes config when not writing', () => {
    const cwd = tmp()
    const [result] = configureMcp(byId('claude-code'), URL_, 'areca-acme-site', cwd, false)
    expect(result).toMatchObject({ status: 'manual', where: '.mcp.json' })
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false)
  })
})

describe('cli', () => {
  it('installs skills and MCP config non-interactively', async () => {
    const cwd = tmp()
    const code = await run(['add', '-a', 'claude-code,opencode', '--mcp-url', URL_, '-y'], cwd)
    expect(code).toBe(0)
    expect(existsSync(join(cwd, '.claude/skills/areca-mcp/SKILL.md'))).toBe(true)
    expect(existsSync(join(cwd, '.agents/skills/areca-sdk/SKILL.md'))).toBe(true)
    expect(readJson(join(cwd, 'opencode.json')).mcp['areca-acme-site']).toEqual({
      type: 'remote',
      url: URL_,
      enabled: true,
    })
  })

  it('exports zips for chat apps and rejects unknown agents', async () => {
    const cwd = tmp()
    expect(await run(['add', '-a', 'claude-app', '-s', 'areca-mcp', '-y'], cwd)).toBe(0)
    expect(existsSync(join(cwd, 'areca-skills/areca-mcp.zip'))).toBe(true)
    expect(existsSync(join(cwd, 'areca-skills/areca-sdk.zip'))).toBe(false)
    expect(await run(['add', '-a', 'nope', '-y'], cwd)).toBe(1)
    expect(await run(['add', '-y'], cwd)).toBe(1)
  })
})
