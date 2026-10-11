import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  tables,
  validateBundle,
  rebaseAssetUrls,
  transformArchivedActors,
} from './authoring-transfer.mjs'
function fixture() {
  const schema = Object.fromEntries(
    tables.map((table) => [
      table,
      ['id', 'organization_id', 'site_id', 'storage_key', 'size', 'status'],
    ]),
  )
  const rows = Object.fromEntries(tables.map((table) => [table, []]))
  rows.organization = [{ id: 'o' }]
  rows.site = [{ id: 's', organization_id: 'o' }]
  const bytes = Buffer.from('asset')
  rows.asset = [
    { id: 'a', organization_id: 'o', storage_key: 'o/a', size: bytes.length },
  ]
  return {
    schema,
    bundle: {
      format: 'areca-organization',
      version: 1,
      schema,
      rows,
      objects: {
        'o/a': {
          base64: bytes.toString('base64'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
    },
  }
}
test('complete authoring bundle validates and rejects corrupt bytes', () => {
  const { schema, bundle } = fixture()
  validateBundle(bundle, schema)
  bundle.objects['o/a'].base64 = Buffer.from('wrong').toString('base64')
  assert.throws(() => validateBundle(bundle, schema), /integrity/)
})
test('rejects unsupported version and schema changes', () => {
  const { schema, bundle } = fixture()
  assert.throws(
    () => validateBundle({ ...bundle, version: 2 }, schema),
    /version/,
  )
  assert.throws(
    () => validateBundle(bundle, { ...schema, site: ['different'] }),
    /schema/,
  )
})
test('rejects cross-organization, cross-site and active build rows', () => {
  const { schema, bundle } = fixture()
  bundle.rows.asset[0].organization_id = 'other'
  assert.throws(() => validateBundle(bundle, schema), /Cross-organization/)
  bundle.rows.asset[0].organization_id = 'o'
  bundle.rows.entry = [{ id: 'e', site_id: 'foreign' }]
  assert.throws(() => validateBundle(bundle, schema), /Foreign site/)
  bundle.rows.entry = []
  bundle.rows.build_job = [{ id: 'j', site_id: 's', status: 'deploying' }]
  assert.throws(() => validateBundle(bundle, schema), /Active jobs/)
})

test('rebases only known asset URLs across authoring history', () => {
  const value = {
    content: [
      { src: 'https://old.test/api/assets/file/org/asset' },
      { src: 'https://external.test/photo.jpg' },
    ],
  }
  assert.deepEqual(
    rebaseAssetUrls(value, new Set(['org/asset']), 'https://new.test'),
    {
      content: [
        { src: 'https://new.test/api/assets/file/org/asset' },
        { src: 'https://external.test/photo.jpg' },
      ],
    },
  )
})

test('maps retained nested camel and snake actor attribution and preserves content IDs', () => {
  const archive = {
    entries: [
      {
        id: 'entry',
        createdBy: 'removed-member',
        revisions: [
          { created_by: 'other-actor', entryId: 'entry', updatedBy: null },
        ],
      },
    ],
    publications: [
      {
        requestedBy: 'deleted-user',
        snapshot: { publicationId: 'publication' },
      },
    ],
  }
  const referenced = new Set()
  transformArchivedActors(archive, (id) => {
    referenced.add(id)
    return id
  })
  assert.deepEqual(
    [...referenced],
    ['removed-member', 'other-actor', 'deleted-user'],
  )
  const users = new Map([
    ['removed-member', 'destination-a'],
    ['other-actor', 'destination-b'],
  ])
  assert.deepEqual(
    transformArchivedActors(archive, (id) => users.get(id) ?? null),
    {
      entries: [
        {
          id: 'entry',
          createdBy: 'destination-a',
          revisions: [
            { created_by: 'destination-b', entryId: 'entry', updatedBy: null },
          ],
        },
      ],
      publications: [
        { requestedBy: null, snapshot: { publicationId: 'publication' } },
      ],
    },
  )
})
test('rejects validation-phase jobs from authoring export', () => {
  const { schema, bundle } = fixture()
  bundle.rows.build_job = [{ id: 'job', site_id: 's', status: 'validating' }]
  assert.throws(() => validateBundle(bundle, schema), /Active jobs/)
})

test('remaps scheduled approvers in retained authoring and archived records', () => {
  assert.deepEqual(
    transformArchivedActors(
      { scheduled_by: 'source', nested: { scheduledBy: 'source' } },
      () => 'destination',
    ),
    { scheduled_by: 'destination', nested: { scheduledBy: 'destination' } },
  )
})
