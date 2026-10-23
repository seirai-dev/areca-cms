import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  renderNotes,
  setFrontmatterVersion,
  takeUnreleased,
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

test('takes a hand-written Unreleased section out, wherever it sits', () => {
  const changelog = [
    '# Changelog',
    '',
    'All notable changes to `x`.',
    '',
    '## 1.0.0 (2026-10-01)',
    '',
    '### Bug fixes',
    '',
    '- old (aaaaaaa)',
    '',
    '## Unreleased',
    '',
    '### Features',
    '',
    '- **manifest:** hand-written note',
    '  that wraps onto a second line.',
    '',
    '### Bug fixes',
    '',
    '- fixed by hand',
    '',
    '## 0.9.0 (2026-09-01)',
    '',
    'No user-facing changes.',
    '',
  ].join('\n')
  const { changelog: stripped, notes } = takeUnreleased(changelog)
  assert.doesNotMatch(stripped, /Unreleased/)
  assert.match(stripped, /## 1\.0\.0 \(2026-10-01\)[\s\S]*## 0\.9\.0 \(2026-09-01\)/)
  assert.deepEqual(notes, [
    { title: 'Features', entries: ['- **manifest:** hand-written note\n  that wraps onto a second line.'] },
    { title: 'Bug fixes', entries: ['- fixed by hand'] },
  ])
  assert.deepEqual(takeUnreleased('# Changelog\n\n## 1.0.0 (x)\n'), { changelog: '# Changelog\n\n## 1.0.0 (x)\n', notes: [] })
})

test('folds hand-written notes into the release, ahead of the generated ones', () => {
  const commits = [commit('feat(seo): og images'), commit('fix: x')].map(parseCommit)
  const handWritten = [
    { title: 'Features', entries: ['- hand-written feature'] },
    { title: 'Documentation', entries: ['- hand-written docs'] },
  ]
  assert.equal(
    renderNotes(commits, handWritten),
    '### Features\n\n- hand-written feature\n- **seo:** og images (abcdef1)\n\n### Bug fixes\n\n- x (abcdef1)\n\n### Documentation\n\n- hand-written docs',
  )
  assert.equal(renderNotes([], handWritten), '### Features\n\n- hand-written feature\n\n### Documentation\n\n- hand-written docs')
  assert.equal(renderNotes([], []), 'No user-facing changes.')
})

test('a changelog with a folded Unreleased section has no Unreleased heading after release', () => {
  const existing = '# Changelog\n\nAll notable changes to `x`.\n\n## 0.1.0 (2026-09-01)\n\n### Bug fixes\n\n- first (aaaaaaa)\n\n## Unreleased\n\n### Features\n\n- **x:** pending (bbbbbbb)\n'
  const { notes } = takeUnreleased(existing)
  const entry = renderEntry('0.2.0', '2026-10-10', [parseCommit(commit('fix: second'))], notes)
  const changelog = prependChangelog(existing, '@areca-cms/x', entry)
  assert.doesNotMatch(changelog, /Unreleased/)
  assert.equal(changelogSection(changelog, '0.2.0'), '### Features\n\n- **x:** pending (bbbbbbb)\n\n### Bug fixes\n\n- second (abcdef1)')
  assert.equal(changelogSection(changelog, '0.1.0'), '### Bug fixes\n\n- first (aaaaaaa)')
})

test('releasing site-sdk folds its Unreleased notes into the new version', () => {
  const repo = join(import.meta.dirname, '../..')
  const tmp = mkdtempSync(join(tmpdir(), 'areca-release-'))
  try {
    cpSync(join(repo, 'packages/site-sdk/package.json'), join(tmp, 'packages/site-sdk/package.json'), { recursive: true })
    cpSync(join(repo, 'packages/site-sdk/CHANGELOG.md'), join(tmp, 'packages/site-sdk/CHANGELOG.md'))
    const { notes } = takeUnreleased(readFileSync(join(tmp, 'packages/site-sdk/CHANGELOG.md'), 'utf8'))
    assert.ok(notes.length > 0, 'the real site-sdk changelog has Unreleased notes')
    const entry = renderEntry('0.5.1', '2026-10-20', [parseCommit(commit('fix(sdk): retry the pull'))], notes)
    writeRelease(tmp, getPackage('site-sdk'), '0.5.1', entry)
    const changelog = readFileSync(join(tmp, 'packages/site-sdk/CHANGELOG.md'), 'utf8')
    assert.doesNotMatch(changelog, /^## Unreleased/m)
    const section = changelogSection(changelog, '0.5.1')
    assert.match(section, /### Features\n\n- \*\*manifest push confirms field removals\.\*\*/)
    assert.match(section, /- \*\*sdk:\*\* retry the pull \(abcdef1\)/)
    assert.equal(JSON.parse(readFileSync(join(tmp, 'packages/site-sdk/package.json'), 'utf8')).version, '0.5.1')
    assert.match(changelogSection(changelog, '0.5.0'), /sdk:\*\* content languages/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('releasing skills folds Unreleased notes and bumps the plugin and SKILL.md files', () => {
  const repo = join(import.meta.dirname, '../..')
  const tmp = mkdtempSync(join(tmpdir(), 'areca-release-'))
  try {
    const changelog = '# Changelog\n\nAll notable changes to `@areca-cms/skills`.\n\n## 0.4.0 (2026-10-14)\n\n### Features\n\n- old feature (aaaaaaa)\n\n## Unreleased\n\n### Bug fixes\n\n- hand-written fix\n'
    for (const path of ['packages/skills/package.json', '.claude-plugin/plugin.json', 'skills']) {
      cpSync(join(repo, path), join(tmp, path), { recursive: true })
    }
    writeFileSync(join(tmp, 'packages/skills/CHANGELOG.md'), changelog)
    const { notes } = takeUnreleased(changelog)
    const changed = writeRelease(tmp, getPackage('skills'), '0.4.1', renderEntry('0.4.1', '2026-10-20', [parseCommit(commit('fix: generated'))], notes))
    const written = readFileSync(join(tmp, 'packages/skills/CHANGELOG.md'), 'utf8')
    assert.doesNotMatch(written, /Unreleased/)
    assert.equal(changelogSection(written, '0.4.1'), '### Bug fixes\n\n- hand-written fix\n- generated (abcdef1)')
    assert.equal(JSON.parse(readFileSync(join(tmp, '.claude-plugin/plugin.json'), 'utf8')).version, '0.4.1')
    assert.ok(changed.includes('packages/skills/CHANGELOG.md'))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
