#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  text,
} from '@clack/prompts'
import {
  AGENTS,
  findAgent,
  GROUP_LABELS,
  mcpServerName,
  validateConnectorUrl,
  type Agent,
} from './agents.js'
import { exportZips, installSkills, removeSkills, resolveTargets, type Scope } from './install.js'
import { configureMcp, type McpResult } from './mcp-config.js'
import { loadSkills, type Skill } from './skills.js'

const USAGE = `Usage: npx @areca-cms/skills [command] [options]

Commands:
  add (default)   Install the Areca skills into your agents
  mcp             Add the Areca MCP server to your agents' project config
  remove          Remove the Areca skills
  export          Write one .zip per skill (Claude app, ChatGPT uploads)
  list            Show supported agents and bundled skills

Options:
  -a, --agent <id>    Agent id, repeatable or comma separated (see list)
  -s, --skill <name>  Only this skill (areca-sdk, areca-mcp, areca-quickstart); default all
  -g, --global        Install into user-level folders instead of the project
      --mcp-url <url> Connector URL to register: <cms>/api/mcp/<site-slug> (one site)
                      or <cms>/api/agency/mcp (agency admins, all sites)
      --out <dir>     Zip folder for chat apps and export (default: areca-skills)
  -y, --yes           No prompts; requires --agent for add/mcp/remove
  -h, --help          Show this help`

class Cancelled extends Error {}

type Options = {
  agents: string[]
  skills: string[]
  global: boolean
  mcpUrl?: string
  out: string
  yes: boolean
}

export async function run(argv: string[], cwd = process.cwd()): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        agent: { type: 'string', short: 'a', multiple: true },
        skill: { type: 'string', short: 's', multiple: true },
        global: { type: 'boolean', short: 'g' },
        'mcp-url': { type: 'string' },
        url: { type: 'string' },
        out: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(USAGE)
    return 1
  }
  const { values, positionals } = parsed
  const command = positionals[0] ?? 'add'
  if (values.help || command === 'help') {
    console.log(USAGE)
    return 0
  }

  const options: Options = {
    agents: splitList(values.agent),
    skills: splitList(values.skill),
    global: values.global === true,
    mcpUrl: values['mcp-url'] ?? values.url,
    out: values.out ?? 'areca-skills',
    yes: values.yes === true || !process.stdin.isTTY,
  }

  try {
    const unknown = options.agents.filter((id) => !findAgent(id))
    if (unknown.length) throw new Error(`Unknown agent: ${unknown.join(', ')}. Run "list" to see ids.`)
    if (options.mcpUrl) {
      const problem = validateConnectorUrl(options.mcpUrl)
      if (problem) throw new Error(problem)
    }

    switch (command) {
      case 'add':
        return await add(options, cwd)
      case 'mcp':
        return await mcp(options, cwd)
      case 'remove':
        return await remove(options, cwd)
      case 'export':
        return exportCommand(options, cwd)
      case 'list':
        return list()
      default:
        console.error(`Unknown command: ${command}\n\n${USAGE}`)
        return 1
    }
  } catch (error) {
    if (error instanceof Cancelled) {
      cancel('Cancelled.')
      return 0
    }
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}

async function add(options: Options, cwd: string): Promise<number> {
  const interactive = !options.yes
  if (interactive) intro('Areca agent skills')

  const agents = await chooseAgents(options, cwd, 'Which agents should get the Areca skills?')
  const skills = await chooseSkills(options)
  const coding = agents.filter((agent) => agent.group !== 'chat')
  const chat = agents.filter((agent) => agent.group === 'chat')

  let scope: Scope = options.global ? 'global' : 'project'
  if (interactive && coding.length && !options.global) {
    scope = unwrap(
      await select({
        message: 'Install for',
        options: [
          { value: 'project' as Scope, label: 'This project', hint: 'commit them so the whole team gets them' },
          { value: 'global' as Scope, label: 'Me, in every project', hint: 'user-level folders' },
        ],
      }),
    )
  }

  const targets = resolveTargets(coding, scope, cwd)
  const written = installSkills(skills, targets)
  for (const target of targets) {
    log.success(`${target.label}  (${target.agents.join(', ')})`)
  }

  if (chat.length) {
    const files = exportZips(skills, resolve(cwd, options.out))
    log.success(`Zips: ${files.map((file) => relative(cwd, file)).join(', ')}`)
  }

  let mcpResults: McpResult[] = []
  if (coding.length) {
    const url = await chooseMcpUrl(options, cwd, interactive)
    if (url) mcpResults = registerMcp(coding, url, scope, cwd)
  }

  const after = [...new Set(agents.map((agent) => agent.after).filter(Boolean))]
  const name = mcpResults.length ? mcpServerName(options.mcpUrl ?? '') : '<name>'
  const steps = [
    `Installed ${skills.map((skill) => skill.name).join(' + ')} (${written.length} folder${written.length === 1 ? '' : 's'}).`,
    ...after.map((line) => line!.replaceAll('<name>', name)),
  ]
  if (interactive) outro(steps.join('\n'))
  else console.log(steps.join('\n'))
  return 0
}

async function mcp(options: Options, cwd: string): Promise<number> {
  const interactive = !options.yes
  if (interactive) intro('Areca MCP server')
  const agents = (await chooseAgents(options, cwd, 'Add the Areca MCP server to which agents?')).filter(
    (agent) => agent.group !== 'chat',
  )
  const url = await chooseMcpUrl({ ...options, yes: options.yes }, cwd, interactive, true)
  if (!url) throw new Error('Pass --url <cms>/api/mcp/<site-slug> or <cms>/api/agency/mcp')
  registerMcp(agents, url, 'project', cwd)
  const after = [...new Set(agents.map((agent) => agent.after).filter(Boolean))].map((line) =>
    line!.replaceAll('<name>', mcpServerName(url)),
  )
  const done = ['Each agent opens a browser to sign in to Areca on first use.', ...after].join('\n')
  if (interactive) outro(done)
  else console.log(done)
  return 0
}

async function remove(options: Options, cwd: string): Promise<number> {
  const interactive = !options.yes
  if (interactive) intro('Remove Areca agent skills')
  const agents = await chooseAgents(options, cwd, 'Remove the Areca skills from which agents?')
  const names = (options.skills.length ? options.skills : loadSkills().map((skill) => skill.name))
  const scope: Scope = options.global ? 'global' : 'project'
  const removed = removeSkills(names, resolveTargets(agents, scope, cwd))
  const message = removed.length ? `Removed ${removed.join(', ')}` : 'Nothing to remove.'
  if (interactive) outro(message)
  else console.log(message)
  return 0
}

function exportCommand(options: Options, cwd: string): number {
  const files = exportZips(selectSkills(options.skills), resolve(cwd, options.out))
  console.log(`Wrote ${files.map((file) => relative(cwd, file)).join(', ')}`)
  for (const id of ['claude-app', 'chatgpt']) console.log(findAgent(id)!.after)
  return 0
}

function list(): number {
  const skills = loadSkills()
  console.log('Skills:')
  for (const skill of skills) console.log(`  ${skill.name.padEnd(12)} ${skill.description.slice(0, 90)}…`)
  for (const group of Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]) {
    console.log(`\n${GROUP_LABELS[group]}:`)
    for (const agent of AGENTS.filter((item) => item.group === group)) {
      const where = agent.projectDir ? `${agent.projectDir}  ~/${agent.globalDir}` : 'zip upload'
      console.log(`  ${agent.id.padEnd(15)} ${agent.label.padEnd(40)} ${where}`)
    }
  }
  return 0
}

async function chooseAgents(options: Options, cwd: string, message: string): Promise<Agent[]> {
  if (options.agents.length) return options.agents.map((id) => findAgent(id)!)
  if (options.yes) throw new Error('Pass --agent <id> (repeatable). Run "list" to see ids.')

  const detected = AGENTS.filter((agent) => agent.detect.some((path) => existsSync(join(cwd, path))))
  const groups: Record<string, { value: string; label: string; hint?: string }[]> = {}
  for (const agent of AGENTS) {
    const group = GROUP_LABELS[agent.group]
    ;(groups[group] ??= []).push({
      value: agent.id,
      label: agent.label,
      hint: agent.projectDir ?? 'zip',
    })
  }
  const ids = unwrap(
    await groupMultiselect({
      message: `${message} (space to toggle, enter to confirm)`,
      options: groups,
      initialValues: detected.map((agent) => agent.id),
      required: true,
    }),
  )
  return ids.map((id) => findAgent(id)!)
}

async function chooseSkills(options: Options): Promise<Skill[]> {
  if (options.skills.length || options.yes) return selectSkills(options.skills)
  const all = loadSkills()
  const names = unwrap(
    await multiselect({
      message: 'Which skills?',
      options: all.map((skill) => ({ value: skill.name, label: skill.name, hint: hintFor(skill.name) })),
      initialValues: all.map((skill) => skill.name),
      required: true,
    }),
  )
  return all.filter((skill) => names.includes(skill.name))
}

function selectSkills(names: string[]): Skill[] {
  const all = loadSkills()
  if (!names.length) return all
  const missing = names.filter((name) => !all.some((skill) => skill.name === name))
  if (missing.length) throw new Error(`Unknown skill: ${missing.join(', ')}. Available: ${all.map((s) => s.name).join(', ')}`)
  return all.filter((skill) => names.includes(skill.name))
}

function hintFor(name: string): string {
  if (name === 'areca-sdk') return 'website code: setup, config, CLI, content, preview, deploy'
  if (name === 'areca-mcp') return 'AI content editing: connect, tools, workflow'
  if (name === 'areca-quickstart') return 'Set up Areca in a new site project (interview + wiring)'
  return ''
}

async function chooseMcpUrl(
  options: Options,
  cwd: string,
  interactive: boolean,
  required = false,
): Promise<string | undefined> {
  if (options.mcpUrl) return options.mcpUrl
  if (!interactive) return undefined
  if (!required) {
    const wanted = unwrap(
      await confirm({
        message: 'Also add the Areca MCP server to these agents? (URL only, sign-in happens in the browser)',
        initialValue: false,
      }),
    )
    if (!wanted) return undefined
  }
  const url = unwrap(
    await text({
      message: 'Connector URL (CMS > your site > Connect AI)',
      placeholder: 'https://cms.example.com/api/mcp/acme-site',
      initialValue: guessConnectorUrl(cwd),
      validate: (value) => validateConnectorUrl(value ?? ''),
    }),
  )
  options.mcpUrl = url
  return url
}

function registerMcp(agents: Agent[], url: string, scope: Scope, cwd: string): McpResult[] {
  const name = mcpServerName(url)
  // Global installs never write outside the repo: show what to add instead.
  const results = configureMcp(agents, url, name, cwd, scope === 'project')
  for (const result of results) {
    if (result.status === 'manual') {
      note(result.snippet, `Add to ${result.where}${result.reason ? ` (${result.reason})` : ''}`)
    } else {
      log.success(`${result.file} ${result.status === 'written' ? 'updated' : 'already set'} (${name})`)
    }
  }
  return results
}

/** `${ARECA_CMS_URL}/api/mcp/${siteKey}` from the site project, if both are present. */
export function guessConnectorUrl(cwd: string): string | undefined {
  const env = ['.env.local', '.env']
    .map((file) => join(cwd, file))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  const cmsUrl = process.env.ARECA_CMS_URL ?? /^\s*ARECA_CMS_URL\s*=\s*["']?([^"'\s#]+)/m.exec(env)?.[1]
  const config = ['areca.config.ts', 'areca.config.mts', 'areca.config.js', 'areca.config.mjs']
    .map((file) => join(cwd, file))
    .find((file) => existsSync(file))
  const siteKey = config ? /siteKey\s*:\s*["'`]([a-z0-9-]+)["'`]/.exec(readFileSync(config, 'utf8'))?.[1] : undefined
  if (!cmsUrl || !siteKey) return undefined
  return `${cmsUrl.replace(/\/+$/, '')}/api/mcp/${siteKey}`
}

function splitList(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
}

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) throw new Cancelled()
  return value as Exclude<T, symbol>
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)).toLowerCase() === realpathSync(entry).toLowerCase()
  } catch {
    return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(entry).toLowerCase()
  }
}

if (isMainModule()) {
  void run(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code)
  })
}
