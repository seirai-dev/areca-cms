import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Agent, McpTarget } from './agents.js'

export type McpResult =
  | { status: 'written' | 'unchanged'; file: string }
  /** Could not edit safely (or no project config exists): show this to the user. */
  | { status: 'manual'; where: string; snippet: string; reason?: string }

/**
 * Register the connector URL (OAuth only, no secrets) for each agent. Files
 * shared by several agents are written once. Existing servers and keys are kept.
 */
export function configureMcp(
  agents: Agent[],
  url: string,
  name: string,
  cwd: string,
  write = true,
): McpResult[] {
  const results: McpResult[] = []
  const seen = new Set<string>()
  for (const agent of agents) {
    for (const target of agent.mcp) {
      const key = target.kind === 'manual' ? `manual:${target.where}` : targetPath(target, name)
      if (seen.has(key)) continue
      seen.add(key)
      results.push(write ? applyTarget(target, url, name, cwd) : describeTarget(target, url, name))
    }
  }
  return results
}

function targetPath(target: Exclude<McpTarget, { kind: 'manual' }>, name: string): string {
  return target.kind === 'yaml' ? `${target.dir}/${name}.yaml` : target.file
}

/** The snippet for a target without touching disk (used for global installs). */
export function describeTarget(target: McpTarget, url: string, name: string): McpResult {
  if (target.kind === 'manual') return { status: 'manual', where: target.where, snippet: target.snippet(name, url) }
  if (target.kind === 'json') {
    return { status: 'manual', where: target.file, snippet: JSON.stringify({ [target.key]: { [name]: target.entry(url) } }, null, 2) }
  }
  if (target.kind === 'toml') {
    return { status: 'manual', where: target.file, snippet: `[mcp_servers.${name}]\nurl = ${JSON.stringify(url)}` }
  }
  return { status: 'manual', where: `${target.dir}/${name}.yaml`, snippet: yamlServer(name, url) }
}

export function applyTarget(target: McpTarget, url: string, name: string, cwd: string): McpResult {
  switch (target.kind) {
    case 'manual':
      return { status: 'manual', where: target.where, snippet: target.snippet(name, url) }
    case 'json':
      return mergeJson(target.file, target.key, name, target.entry(url), cwd)
    case 'toml':
      return appendToml(target.file, name, url, cwd)
    case 'yaml': {
      const file = `${target.dir}/${name}.yaml`
      return writeIfChanged(join(cwd, file), file, yamlServer(name, url))
    }
  }
}

function mergeJson(file: string, key: string, name: string, entry: Record<string, unknown>, cwd: string): McpResult {
  const path = join(cwd, file)
  const snippet = JSON.stringify({ [key]: { [name]: entry } }, null, 2)
  let config: Record<string, unknown> = {}
  if (existsSync(path)) {
    const source = readFileSync(path, 'utf8')
    try {
      config = source.trim() ? JSON.parse(source) : {}
    } catch {
      // JSONC with comments: rewriting it would drop them, so let the user paste.
      return { status: 'manual', where: file, snippet, reason: 'has comments or invalid JSON' }
    }
    if (!isObject(config)) return { status: 'manual', where: file, snippet, reason: 'is not a JSON object' }
  }
  const servers = config[key] ?? {}
  if (!isObject(servers)) return { status: 'manual', where: file, snippet, reason: `"${key}" is not an object` }
  const next = { ...config, [key]: { ...servers, [name]: entry } }
  return writeIfChanged(path, file, `${JSON.stringify(next, null, 2)}\n`)
}

function appendToml(file: string, name: string, url: string, cwd: string): McpResult {
  const path = join(cwd, file)
  const section = `[mcp_servers.${name}]\nurl = ${JSON.stringify(url)}\n`
  const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const header = new RegExp(`^\\[mcp_servers\\.(?:${name}|"${name}")\\]`, 'm')
  if (header.test(source)) {
    if (source.includes(`url = ${JSON.stringify(url)}`)) return { status: 'unchanged', file }
    return { status: 'manual', where: file, snippet: section, reason: `already has [mcp_servers.${name}]` }
  }
  const prefix = source && !source.endsWith('\n') ? `${source}\n` : source
  return writeIfChanged(path, file, `${prefix}${prefix ? '\n' : ''}${section}`)
}

function writeIfChanged(path: string, file: string, body: string): McpResult {
  if (existsSync(path) && readFileSync(path, 'utf8') === body) return { status: 'unchanged', file }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  return { status: 'written', file }
}

function yamlServer(name: string, url: string): string {
  return `name: ${name}\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: ${name}\n    type: streamable-http\n    url: ${url}\n`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
