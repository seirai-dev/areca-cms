import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Each package releases on its own. `paths` decide which commits count towards
// a release; `versionFiles` are bumped together (drift.test.ts checks the
// skills ones match).
export const PACKAGES = {
  'site-sdk': {
    name: '@areca-cms/site-sdk',
    dir: 'packages/site-sdk',
    paths: ['packages/site-sdk'],
  },
  skills: {
    name: '@areca-cms/skills',
    dir: 'packages/skills',
    paths: ['packages/skills', 'skills', '.claude-plugin'],
    pluginJson: '.claude-plugin/plugin.json',
    skillsDir: 'skills',
  },
}

export const BUMPS = ['patch', 'minor', 'major']

export function getPackage(id) {
  const pkg = PACKAGES[id]
  if (!pkg) throw new Error(`Unknown package "${id}". Use one of: ${Object.keys(PACKAGES).join(', ')}`)
  return { id, ...pkg }
}

export function tagName(id, version) {
  return `${id}-v${version}`
}

const HEADER = /^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/

export function parseCommit({ hash, subject, body = '' }) {
  const match = HEADER.exec(subject.trim())
  if (!match) return null
  const [, type, scope, bang, description] = match
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE: /m.test(body)
  return { hash, type: type.toLowerCase(), scope: scope || null, breaking, description }
}

// Only these produce a release; docs, chore, test, ci, refactor and style do not.
export function commitBump(commit) {
  if (commit.breaking) return 'major'
  if (commit.type === 'feat') return 'minor'
  if (commit.type === 'fix' || commit.type === 'perf') return 'patch'
  return null
}

export function highestBump(commits) {
  let best = null
  for (const commit of commits) {
    const bump = commitBump(commit)
    if (bump && (!best || BUMPS.indexOf(bump) > BUMPS.indexOf(best))) best = bump
  }
  return best
}

// Below 1.0.0 a breaking change bumps minor; going to 1.0.0 takes an explicit
// "major" from the manual workflow run.
export function nextVersion(version, bump, { explicit = false } = {}) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Unsupported version "${version}"`)
  let [major, minor, patch] = match.slice(1).map(Number)
  if (bump === 'major' && major === 0 && !explicit) bump = 'minor'
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump "${bump}"`)
}

// `override` is the manual run's bump input: "auto" (or empty) uses the commits.
export function planRelease({ version, commits, override }) {
  const parsed = commits.map(parseCommit).filter(Boolean)
  const releasable = parsed.filter((commit) => commitBump(commit))
  const explicit = Boolean(override) && override !== 'auto'
  const bump = explicit ? override : highestBump(releasable)
  if (!bump) return null
  return { bump, current: version, next: nextVersion(version, bump, { explicit }), commits: releasable }
}

const SECTIONS = [
  ['Breaking changes', (commit) => commit.breaking],
  ['Features', (commit) => !commit.breaking && commit.type === 'feat'],
  ['Bug fixes', (commit) => !commit.breaking && commit.type === 'fix'],
  ['Performance', (commit) => !commit.breaking && commit.type === 'perf'],
]
const SECTION_TITLES = SECTIONS.map(([title]) => title)

function generatedSections(commits) {
  return SECTIONS.map(([title, matches]) => ({
    title,
    entries: commits
      .filter(matches)
      .map((commit) => `- ${commit.scope ? `**${commit.scope}:** ` : ''}${commit.description} (${commit.hash.slice(0, 7)})`),
  })).filter((section) => section.entries.length)
}

// Hand-written notes go first within a section, then the generated ones. Known
// sections keep their order; hand-written sections the commits do not cover
// come after them, in the order they were written.
function mergeSections(generated, handWritten) {
  const merged = new Map()
  for (const { title, entries } of generated) merged.set(title, [...entries])
  for (const { title, entries } of handWritten) {
    merged.set(title, [...entries, ...(merged.get(title) ?? [])])
  }
  const rank = (title) => {
    const index = SECTION_TITLES.indexOf(title)
    return index === -1 ? SECTION_TITLES.length : index
  }
  return [...merged]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([title, entries]) => ({ title, entries }))
}

export function renderNotes(commits, handWritten = []) {
  const sections = mergeSections(generatedSections(commits), handWritten)
  if (!sections.length) return 'No user-facing changes.'
  return sections.map(({ title, entries }) => `### ${title}\n\n${entries.join('\n')}`).join('\n\n')
}

export function renderEntry(version, date, commits, handWritten = []) {
  return `## ${version} (${date})\n\n${renderNotes(commits, handWritten)}\n`
}

const UNRELEASED = /^## Unreleased[ \t]*\n/m

// `### ` groups of hand-written notes. A bullet keeps the lines that follow it.
function parseNoteSections(body) {
  const sections = []
  let section = null
  for (const line of body.split('\n')) {
    const heading = /^### (.+?)\s*$/.exec(line)
    if (heading) {
      section = { title: heading[1], entries: [] }
      sections.push(section)
    } else if (line.trim()) {
      if (!section) {
        section = { title: 'Changes', entries: [] }
        sections.push(section)
      }
      if (line.startsWith('- ') || section.entries.length === 0) section.entries.push(line)
      else section.entries[section.entries.length - 1] += `\n${line}`
    }
  }
  return sections
}

// A hand-written `## Unreleased` section, wherever it sits. It is removed from
// the changelog, and its notes are returned for the next release to fold in.
export function takeUnreleased(changelog) {
  const match = UNRELEASED.exec(changelog)
  if (!match) return { changelog, notes: [] }
  const bodyStart = match.index + match[0].length
  const next = changelog.slice(bodyStart).search(/^## /m)
  const bodyEnd = next === -1 ? changelog.length : bodyStart + next
  return {
    changelog: changelog.slice(0, match.index) + changelog.slice(bodyEnd),
    notes: parseNoteSections(changelog.slice(bodyStart, bodyEnd)),
  }
}

export function prependChangelog(existing, name, entry) {
  const title = `# Changelog\n\nAll notable changes to \`${name}\`.\n`
  const { changelog } = takeUnreleased(existing)
  const first = changelog.search(/^## /m)
  const rest = first === -1 ? '' : changelog.slice(first)
  return `${title}\n${entry}${rest ? `\n${rest}` : ''}`
}

// The section for `version`, without its heading, for GitHub Release notes.
export function changelogSection(changelog, version) {
  const start = changelog.indexOf(`\n## ${version} `)
  if (start === -1) return null
  const body = changelog.slice(changelog.indexOf('\n', start + 1) + 1)
  const end = body.search(/^## /m)
  return (end === -1 ? body : body.slice(0, end)).trim()
}

// Replaces `version: "x"` inside the YAML frontmatter only.
export function setFrontmatterVersion(markdown, version) {
  const match = /^---\n[\s\S]*?\n---\n/.exec(markdown)
  if (!match) throw new Error('SKILL.md has no frontmatter')
  const line = /^(\s+version: )"[^"]*"$/m
  if (!line.test(match[0])) throw new Error('SKILL.md frontmatter has no version')
  return match[0].replace(line, `$1"${version}"`) + markdown.slice(match[0].length)
}

function setJsonVersion(file, version) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  json.version = version
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}

export function readVersion(root, pkg) {
  return JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8')).version
}

// Writes the new version everywhere it lives, plus the changelog entry.
// Returns the repo-relative files it changed.
export function writeRelease(root, pkg, version, entry) {
  const changed = [join(pkg.dir, 'package.json')]
  setJsonVersion(join(root, pkg.dir, 'package.json'), version)

  if (pkg.pluginJson) {
    setJsonVersion(join(root, pkg.pluginJson), version)
    changed.push(pkg.pluginJson)
  }
  if (pkg.skillsDir) {
    for (const dirent of readdirSync(join(root, pkg.skillsDir), { withFileTypes: true })) {
      const file = join(pkg.skillsDir, dirent.name, 'SKILL.md')
      if (!dirent.isDirectory() || !existsSync(join(root, file))) continue
      writeFileSync(join(root, file), setFrontmatterVersion(readFileSync(join(root, file), 'utf8'), version))
      changed.push(file)
    }
  }

  const changelog = join(pkg.dir, 'CHANGELOG.md')
  const existing = existsSync(join(root, changelog)) ? readFileSync(join(root, changelog), 'utf8') : ''
  writeFileSync(join(root, changelog), prependChangelog(existing, pkg.name, entry))
  changed.push(changelog)
  return changed
}
