import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bumpVersion,
  movingTags,
  normalizeVersion,
  parseVersion,
  previousVersion,
  releaseTags,
  resolveVersion,
} from './cms-lib.mjs'

const tags = ['v0.0.18', 'v0.1.0', 'v0.1.2', 'site-sdk-v0.10.1', 'skills-v0.8.0', 'v0.1.10']

test('parseVersion accepts only vX.Y.Z', () => {
  assert.deepEqual(parseVersion('v1.20.3'), [1, 20, 3])
  for (const bad of ['1.2.3', 'v1.2', 'v1.2.3-rc.1', 'v01.2.3', 'skills-v0.1.0', 'latest']) {
    assert.equal(parseVersion(bad), null, bad)
  }
})

test('releaseTags ignores package tags and sorts numerically', () => {
  assert.deepEqual(releaseTags(tags), ['v0.1.10', 'v0.1.2', 'v0.1.0', 'v0.0.18'])
})

test('normalizeVersion adds the v and rejects pre-releases', () => {
  assert.equal(normalizeVersion('0.1.0'), 'v0.1.0')
  assert.equal(normalizeVersion(' v0.1.0 '), 'v0.1.0')
  assert.throws(() => normalizeVersion('v0.2.0-rc.1'), /not a version/)
  assert.throws(() => normalizeVersion(''), /not a version/)
})

test('bumpVersion', () => {
  assert.equal(bumpVersion('v0.1.10', 'patch'), 'v0.1.11')
  assert.equal(bumpVersion('v0.1.10', 'minor'), 'v0.2.0')
  assert.equal(bumpVersion('v0.1.10', 'major'), 'v1.0.0')
  assert.throws(() => bumpVersion('v0.1.0', 'auto'), /Unknown bump/)
})

test('resolveVersion bumps the highest version unless one is given', () => {
  assert.equal(resolveVersion({ tags, bump: 'patch' }), 'v0.1.11')
  assert.equal(resolveVersion({ tags, bump: 'minor' }), 'v0.2.0')
  assert.equal(resolveVersion({ tags, version: '0.0.19', bump: 'major' }), 'v0.0.19')
  assert.throws(() => resolveVersion({ tags: ['skills-v0.1.0'], bump: 'patch' }), /first release/)
  assert.equal(resolveVersion({ tags: [], version: 'v0.1.0' }), 'v0.1.0')
})

test('movingTags moves vX.Y and latest only forwards', () => {
  assert.deepEqual(movingTags({ tags, version: 'v0.1.11' }), { minorTag: 'v0.1', moved: ['v0.1', 'latest'], latest: true })
  // A back-filled patch in an older line moves only its own line.
  assert.deepEqual(movingTags({ tags, version: 'v0.0.19' }), { minorTag: 'v0.0', moved: ['v0.0'], latest: false })
  // An older patch inside the newest line moves nothing.
  assert.deepEqual(movingTags({ tags, version: 'v0.1.1' }), { minorTag: 'v0.1', moved: [], latest: false })
  // A new line with nothing in it yet.
  assert.deepEqual(movingTags({ tags, version: 'v0.0.5' }), { minorTag: 'v0.0', moved: [], latest: false })
  assert.deepEqual(movingTags({ tags: [], version: 'v0.1.0' }), { minorTag: 'v0.1', moved: ['v0.1', 'latest'], latest: true })
})

test('movingTags treats the version itself as already tagged (pushed tag or re-run)', () => {
  assert.deepEqual(movingTags({ tags: [...tags, 'v0.2.0'], version: 'v0.2.0' }).moved, ['v0.2', 'latest'])
  assert.deepEqual(movingTags({ tags, version: 'v0.1.10' }).moved, ['v0.1', 'latest'])
})

test('previousVersion is the highest version below', () => {
  assert.equal(previousVersion({ tags, version: 'v0.1.11' }), 'v0.1.10')
  assert.equal(previousVersion({ tags, version: 'v0.1.10' }), 'v0.1.2')
  assert.equal(previousVersion({ tags, version: 'v0.0.19' }), 'v0.0.18')
  assert.equal(previousVersion({ tags, version: 'v0.0.1' }), null)
})
