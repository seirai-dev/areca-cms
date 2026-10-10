#!/usr/bin/env node
// Release helper for the npm packages, driven by .github/workflows/release.yml.
//
//   node scripts/release/release.mjs status <package>
//   node scripts/release/release.mjs prepare <package> [--bump auto|patch|minor|major] [--notes-file path]
//   node scripts/release/release.mjs notes <package> [--notes-file path]
//
// `status` reports whether the version in package.json is tagged and on npm.
// `prepare` bumps the version files and changelog from the conventional commits
// since that tag. Results go to stdout and, in Actions, to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  BUMPS,
  changelogSection,
  getPackage,
  planRelease,
  readVersion,
  renderEntry,
  renderNotes,
  tagName,
  writeRelease,
} from './lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function tagExists(tag) {
  try {
    git('rev-parse', '--quiet', '--verify', `refs/tags/${tag}`)
    return true
  } catch {
    return false
  }
}

function publishedOnNpm(name, version) {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', stdio: 'pipe' })
    return true
  } catch (error) {
    if (/E404|is not in this registry/.test(String(error.stderr))) return false
    throw error
  }
}

function commitsSince(tag, paths) {
  const log = git('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', `${tag}..HEAD`, '--', ...paths)
  return log
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body] = record.split('\x1f')
      return { hash, subject, body }
    })
}

function output(values) {
  console.log(JSON.stringify(values, null, 2))
  if (!process.env.GITHUB_OUTPUT) return
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'object') appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { bump: { type: 'string', default: 'auto' }, 'notes-file': { type: 'string' } },
})
const [command, id] = positionals
const pkg = getPackage(id)
const version = readVersion(root, pkg)
const tag = tagName(pkg.id, version)

// The commit to publish and tag. Once a package has tags, that is the commit
// that set the version (the merged release PR), even if master has moved on.
// The first run baselines at HEAD.
function releaseCommit() {
  const head = git('rev-parse', 'HEAD').trim()
  if (!git('tag', '--list', `${pkg.id}-v*`).trim()) return head
  const file = join(pkg.dir, 'package.json')
  return git('log', '-1', '--format=%H', `-S"version": "${version}"`, '--', file).trim() || head
}

function hasChangelogEntry() {
  const changelog = join(root, pkg.dir, 'CHANGELOG.md')
  return existsSync(changelog) && changelogSection(readFileSync(changelog, 'utf8'), version) !== null
}

if (command === 'status') {
  output({
    name: pkg.name,
    dir: pkg.dir,
    version,
    tag,
    tagged: tagExists(tag),
    published: publishedOnNpm(pkg.name, version),
    sha: releaseCommit(),
    changelog: hasChangelogEntry(),
  })
} else if (command === 'prepare') {
  if (values.bump !== 'auto' && !BUMPS.includes(values.bump)) throw new Error(`Unknown bump "${values.bump}"`)
  if (!tagExists(tag)) throw new Error(`${tag} is not tagged yet; publish it before preparing the next release`)
  const plan = planRelease({ version, commits: commitsSince(tag, pkg.paths), override: values.bump })
  if (!plan) {
    output({ next: '' })
  } else {
    const date = new Date().toISOString().slice(0, 10)
    const changed = writeRelease(root, pkg, plan.next, renderEntry(plan.next, date, plan.commits))
    if (values['notes-file']) writeFileSync(values['notes-file'], renderNotes(plan.commits))
    output({ next: plan.next, bump: plan.bump, changed })
  }
} else if (command === 'notes') {
  const changelog = join(root, pkg.dir, 'CHANGELOG.md')
  const notes = (existsSync(changelog) && changelogSection(readFileSync(changelog, 'utf8'), version)) || 'Initial release.'
  if (values['notes-file']) writeFileSync(values['notes-file'], `${notes}\n`)
  else console.log(notes)
} else {
  throw new Error(`Unknown command "${command}". Use status, prepare or notes.`)
}
