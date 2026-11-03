import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { decode, encode } from './.local/wire.mjs'

test('wire adapter decodes deployed-style results and rejects serialized failures', () => {
  const envelope = JSON.parse(encode({ answer: 42 }))
  // toJSON uses an envelope; server responses use its cross-JSON root.
  assert.deepEqual(decode(JSON.stringify(envelope.t)), { data: { answer: 42 } })
  assert.throws(() => decode('{"error":"failed"}'))
  assert.throws(() => decode('Not JSON'))
})

test('randomized state machine runs all personas without network or state conflicts', async () => {
  const source = (
    await readFile(new URL('./workload.js', import.meta.url), 'utf8')
  )
    .replace(/^import .*\n/gm, '')
    .replace(/export default function\s*\(\)/, 'function step()')
    .replaceAll('export const ', 'const ')
    .replaceAll('export function ', 'function ')
  const people = Array.from({ length: 20 }, (_, i) => ({
    id: `user-${i}`,
    email: `user-${i}@example.invalid`,
    role: i === 0 ? 'admin' : i % 4 === 0 ? 'owner' : 'editor',
    cookie: `cookie-${i}`,
    siteId: 'site',
    organizationId: 'org',
    entries: ['articles', 'news', 'pages'].map((key) => ({
      id: `entry-${i}-${key}`,
      key,
    })),
  }))
  let calls = 0,
    totalFailures = 0
  const operations = new Set(),
    store = new Map()
  for (const user of people) {
    const execution = {
      scenario: { startTime: Date.now() - 121000 },
      vu: { idInTest: people.indexOf(user) + 1 },
    }
    const metrics = class {
      constructor(name) {
        this.name = name
      }
      add(value) {
        if (
          (this.name === 'bench_failure' || this.name === 'journey_failure') &&
          value
        )
          totalFailures++
      }
    }
    const open = (path) =>
      path === './fixtures.json'
        ? JSON.stringify({ users: people })
        : path === './config.json'
          ? JSON.stringify({ base: 'https://example.invalid', prefix: 'test' })
          : path === './manifest.json'
            ? JSON.stringify({
                listEntryCountsFn: { id: 'count', method: 'GET' },
              })
            : new ArrayBuffer(10)
    const rpcRequest = (_base, _manifest, name, data) => ({
      url: name,
      body: JSON.stringify(data),
      method:
        name.startsWith('get') || name.startsWith('list') ? 'GET' : 'POST',
      headers: {},
    })
    const response = (value, status = 200) => ({
      status,
      body: JSON.stringify(value),
      json: () => value,
      timings: { duration: 1 },
    })
    const http = {
      file: () => 0,
      post: () =>
        response({ id: `asset-${calls++}`, storageKey: 'org/photo.jpg' }),
      get: () => response('<!DOCTYPE html><html></html>'),
      request: (_method, name, body) => {
        const data = JSON.parse(body)
        operations.add(name)
        calls++
        if (name === 'getMeFn') return response({ user: { id: user.id } })
        if (name === 'listEntryCountsFn')
          return response({ articles: 31, news: 31, pages: 31 })
        if (name === 'listEntriesFn' || name === 'listRevisionsFn')
          return response({ items: [] })
        if (name === 'listAssetsFn') return response([{ id: 'seed-asset' }])
        if (name.startsWith('list')) return response([])
        if (name === 'getPreviewUrlFn')
          return response({ url: 'https://example.invalid' })
        if (name === 'getEntryFn')
          return response(
            store.get(data.id) || {
              id: data.id,
              slug: 'sample',
              draftVersion: 1,
            },
          )
        if (name === 'createEntryFn') {
          const entry = {
            id: `created-${calls}`,
            slug: data.data.slug,
            draftVersion: 1,
          }
          store.set(entry.id, entry)
          return response(entry)
        }
        if (name === 'updateDraftFn') {
          const entry = store.get(data.id) || {
            id: data.id,
            slug: 'sample',
            draftVersion: 1,
          }
          assert.equal(
            entry.draftVersion,
            data.expectedVersion,
            'Optimistic version must match current entry',
          )
          const updated = { ...entry, draftVersion: entry.draftVersion + 1 }
          store.set(data.id, updated)
          return response(updated)
        }
        if (name.startsWith('delete')) return response({ ok: true })
        return response({ id: data.id || `object-${calls}` })
      },
    }
    const SharedArray = class {
      constructor(_name, fn) {
        return fn()
      }
    }
    const factory = new Function(
      'http',
      'sleep',
      'exec',
      'SharedArray',
      'Counter',
      'Rate',
      'Trend',
      'rpcRequest',
      'decode',
      'open',
      '__ENV',
      `${source}\nreturn {step, snapshot:()=>state};`,
    )
    const workload = factory(
      http,
      () => {},
      execution,
      SharedArray,
      metrics,
      metrics,
      metrics,
      rpcRequest,
      JSON.parse,
      open,
      { BENCH_VUS: '20' },
    )
    for (let i = 0; i < 1200; i++) workload.step()
    assert.equal(workload.snapshot().user.id, user.id)
  }
  assert.ok(calls > 20000)
  assert.equal(
    totalFailures,
    0,
    'All generated actions should produce valid responses',
  )
  for (const name of [
    'createEntryFn',
    'updateDraftFn',
    'deleteEntryFn',
    'scheduleEntryFn',
    'publishEntryFn',
    'archiveEntryFn',
    'createOrganizationFn',
    'createSiteFn',
    'upsertCollectionFn',
  ])
    assert.ok(operations.has(name), `${name} was never exercised`)
})
