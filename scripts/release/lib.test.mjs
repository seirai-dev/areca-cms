import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  changelogSection,
  getPackage,
  nextVersion,
  parseCommit,
  planRelease,
  prependChangelog,
  renderEntry,
  setFrontmatterVersion,
  writeRelease,
} from './lib.mjs'

const commit = (subject, body = '') => ({ hash: 'abcdef1234567890', subject, body })

test('parses conventional commit subjects', () => {
  assert.deepEqual(parseCommit(commit('feat(cli): add pull --watch')), {
    hash: 'abcdef1234567890',
    type: 'feat',
    scope: 'cli',
    breaking: false,
    description: 'add pull --watch',
  })
  assert.equal(parseCommit(commit('fix!: drop node 20')).breaking, true)
  assert.equal(parseCommit(commit('fix: x', 'Details\n\nBREAKING CHANGE: renamed export')).breaking, true)
  assert.equal(parseCommit(commit('Merge pull request #7 from ekozf/x')), null)
})

test('only feat, fix, perf and breaking commits release', () => {
  const commits = ['docs: readme', 'chore: deps', 'test: more', 'refactor: tidy', 'ci: cache'].map((s) => commit(s))
  assert.equal(planRelease({ version: '0.2.0', commits }), null)
  assert.equal(planRelease({ version: '0.2.0', commits: [...commits, commit('perf: faster pull')] }).next, '0.2.1')
})

test('picks the highest bump, with breaking changes as minor below 1.0', () => {
  const fix = commit('fix: a')
  const feat = commit('feat: b')
  const breaking = commit('feat!: c')
  assert.equal(planRelease({ version: '0.2.0', commits: [fix] }).next, '0.2.1')
  assert.equal(planRelease({ version: '0.2.3', commits: [fix, feat] }).next, '0.3.0')
  assert.equal(planRelease({ version: '0.2.3', commits: [fix, breaking] }).next, '0.3.0')
  assert.equal(planRelease({ version: '1.2.3', commits: [fix, breaking] }).next, '2.0.0')
})

test('an explicit bump overrides the commits', () => {
  assert.equal(planRelease({ version: '0.2.0', commits: [], override: 'patch' }).next, '0.2.1')
  assert.equal(planRelease({ version: '0.2.0', commits: [commit('fix: a')], override: 'major' }).next, '1.0.0')
  assert.equal(planRelease({ version: '0.2.0', commits: [commit('fix: a')], override: 'auto' }).next, '0.2.1')
  assert.throws(() => nextVersion('0.2.0-beta.1', 'patch'))
})

test('renders changelog entries and reads them back', () => {
  const commits = [commit('feat(seo): og images'), commit('fix: x'), commit('feat!: y')].map(parseCommit)
  const entry = renderEntry('0.3.0', '2026-10-10', commits)
  assert.equal(
    entry,
    '## 0.3.0 (2026-10-10)\n\n### Breaking changes\n\n- y (abcdef1)\n\n### Features\n\n- **seo:** og images (abcdef1)\n\n### Bug fixes\n\n- x (abcdef1)\n',
  )
  const first = prependChangelog('', '@areca-cms/site-sdk', renderEntry('0.2.1', '2026-10-01', [parseCommit(commit('fix: z'))]))
  const changelog = prependChangelog(first, '@areca-cms/site-sdk', entry)
  assert.match(changelog, /^# Changelog\n\nAll notable changes to `@areca-cms\/site-sdk`\.\n\n## 0\.3\.0/)
  assert.equal(changelog.match(/# Changelog/g).length, 1)
  assert.equal(changelogSection(changelog, '0.2.1'), '### Bug fixes\n\n- z (abcdef1)')
  assert.match(changelogSection(changelog, '0.3.0'), /^### Breaking changes[\s\S]*- x \(abcdef1\)$/)
  assert.equal(changelogSection(changelog, '9.9.9'), null)
})

test('sets the version in SKILL.md frontmatter only', () => {
  const skill = '---\nname: a\nmetadata:\n  version: "0.1.0"\n---\n\nWrites return a version: "0.1.0" too.\n'
  assert.equal(
    setFrontmatterVersion(skill, '0.2.0'),
    '---\nname: a\nmetadata:\n  version: "0.2.0"\n---\n\nWrites return a version: "0.1.0" too.\n',
  )
  assert.throws(() => setFrontmatterVersion('---\nname: a\n---\n', '0.2.0'))
})

test('writes every skills version file the drift test checks', () => {
  const repo = join(import.meta.dirname, '../..')
  const tmp = mkdtempSync(join(tmpdir(), 'areca-release-'))
  try {
    for (const path of ['packages/skills/package.json', '.claude-plugin/plugin.json', 'skills']) {
      cpSync(join(repo, path), join(tmp, path), { recursive: true })
    }
    const changed = writeRelease(tmp, getPackage('skills'), '9.8.7', '## 9.8.7 (2026-10-10)\n\nNo user-facing changes.\n')
    assert.ok(changed.includes('.claude-plugin/plugin.json'))
    assert.equal(JSON.parse(readFileSync(join(tmp, 'packages/skills/package.json'), 'utf8')).version, '9.8.7')
    assert.equal(JSON.parse(readFileSync(join(tmp, '.claude-plugin/plugin.json'), 'utf8')).version, '9.8.7')
    for (const file of changed.filter((file) => file.endsWith('SKILL.md'))) {
      assert.match(readFileSync(join(tmp, file), 'utf8'), /^ {2}version: "9\.8\.7"$/m)
    }
    assert.equal(changed.filter((file) => file.endsWith('SKILL.md')).length, 2)
    assert.match(readFileSync(join(tmp, 'packages/skills/CHANGELOG.md'), 'utf8'), /## 9\.8\.7/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
