#!/usr/bin/env node
// Release helper for the CMS Docker image, driven by .github/workflows/cms-release.yml.
//
//   node scripts/release/cms.mjs plan [--version vX.Y.Z | --bump patch|minor|major]
//   node scripts/release/cms.mjs default-commit [--ref origin/main]
//   node scripts/release/cms.mjs notes --version vX.Y.Z --commit <sha> --image <name> [--notes-file path]
//
// `plan` works out the version and which moving tags (vX.Y, latest) it moves.
// `default-commit` is the newest commit on main that got an image.
// `notes` writes the GitHub Release notes. Results go to stdout and, in
// Actions, to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseCommit, renderNotes } from './lib.mjs'
import { CMS_PATHS, movingTags, normalizeVersion, previousVersion, resolveVersion } from './cms-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function versionTags() {
  return git('tag', '--list', 'v*').split('\n').filter(Boolean)
}

function output(values) {
  console.log(JSON.stringify(values, null, 2))
  if (!process.env.GITHUB_OUTPUT) return
  for (const [key, value] of Object.entries(values)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${Array.isArray(value) ? value.join(' ') : value}\n`)
  }
}

// Commits in `range` that touch the CMS, as conventional commits.
function cmsCommits(range) {
  const log = git('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range, '--', ...CMS_PATHS)
  return log
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body] = record.split('\x1f')
      return parseCommit({ hash, subject, body })
    })
    .filter(Boolean)
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'string' },
    bump: { type: 'string' },
    commit: { type: 'string' },
    image: { type: 'string' },
    ref: { type: 'string', default: 'origin/main' },
    'notes-file': { type: 'string' },
  },
})
const [command] = positionals

if (command === 'plan') {
  const tags = versionTags()
  const version = resolveVersion({ tags, version: values.version, bump: values.bump || 'patch' })
  const { minorTag, moved, latest } = movingTags({ tags, version })
  output({ version, minorTag, moved, latest, previous: previousVersion({ tags, version }) ?? '' })
} else if (command === 'default-commit') {
  // First parent, so a merged pull request counts as its merge commit, which
  // is the commit main built.
  const commit = git('log', '-1', '--first-parent', '--format=%H', values.ref, '--', ...CMS_PATHS).trim()
  if (!commit) throw new Error(`No commit on ${values.ref} touches the CMS`)
  output({ commit })
} else if (command === 'notes') {
  if (!values.commit || !values.image) throw new Error('notes needs --commit and --image')
  const version = normalizeVersion(values.version ?? '')
  const previous = previousVersion({ tags: versionTags(), version })
  const changes = previous
    ? renderNotes(cmsCommits(`${previous}..${values.commit}`))
    : 'The first versioned release of the Areca CMS image.'
  const notes = [
    '```shell',
    `docker pull ${values.image}:${version}`,
    '```',
    '',
    `Built from ${values.commit}.${previous ? ` Changes since ${previous}:` : ''}`,
    '',
    changes,
    '',
  ].join('\n')
  if (values['notes-file']) writeFileSync(values['notes-file'], notes)
  else console.log(notes)
} else {
  throw new Error(`Unknown command "${command}". Use plan, default-commit or notes.`)
}
