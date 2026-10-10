import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from './agents.js'
import { skillFiles, type Skill } from './skills.js'
import { createZip } from './zip.js'

export type Scope = 'project' | 'global'

export type InstallTarget = {
  /** Absolute skills directory, e.g. `<repo>/.agents/skills`. */
  dir: string
  /** Display path, e.g. `.agents/skills` or `~/.claude/skills`. */
  label: string
  agents: string[]
}

/** One target per unique skills directory, so shared folders get one copy. */
export function resolveTargets(agents: Agent[], scope: Scope, cwd: string, home = homedir()): InstallTarget[] {
  const byDir = new Map<string, InstallTarget>()
  for (const agent of agents) {
    const rel = scope === 'project' ? agent.projectDir : agent.globalDir
    if (!rel) continue
    const dir = scope === 'project' ? join(cwd, rel) : join(home, rel)
    const label = scope === 'project' ? rel : `~/${rel}`
    const target = byDir.get(dir) ?? { dir, label, agents: [] }
    target.agents.push(agent.label)
    byDir.set(dir, target)
  }
  return [...byDir.values()]
}

/** Replace each skill folder in each target with a fresh copy. */
export function installSkills(skills: Skill[], targets: InstallTarget[]): string[] {
  const written: string[] = []
  for (const target of targets) {
    for (const skill of skills) {
      const dest = join(target.dir, skill.name)
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(target.dir, { recursive: true })
      cpSync(skill.dir, dest, { recursive: true })
      written.push(`${target.label}/${skill.name}`)
    }
  }
  return written
}

/** Remove only the named skill folders; other skills in the folder stay. */
export function removeSkills(names: string[], targets: InstallTarget[]): string[] {
  const removed: string[] = []
  for (const target of targets) {
    for (const name of names) {
      const dest = join(target.dir, name)
      if (!existsSync(dest)) continue
      rmSync(dest, { recursive: true, force: true })
      removed.push(`${target.label}/${name}`)
    }
  }
  return removed
}

/** One `<name>.zip` per skill with the folder at the zip root (Claude app / ChatGPT upload format). */
export function exportZips(skills: Skill[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true })
  return skills.map((skill) => {
    const entries = skillFiles(skill.dir).map(([path, data]) => ({ path: `${skill.name}/${path}`, data }))
    const file = join(outDir, `${skill.name}.zip`)
    writeFileSync(file, createZip(entries))
    return file
  })
}
