import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanContent, scanDirectory } from './scan-client-bundle.mjs'

const rules = (content, env) =>
  scanContent('a.js', content, env).map((f) => f.rule)

test('a UI-named env variable may appear as a name, but not with its value', () => {
  const name = 'CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY'
  assert.deepEqual(rules(`Set ${name} on the server`), [])
  const value = 'Zm9vYmFyYmF6cXV4enl6MTIzNDU2Nzg5MGFiY2RlZmdoaWo='
  assert.deepEqual(rules(`const k = "${value}"`, { [name]: value }), [
    `server-env-value:${name}`,
  ])
})

test('clean client code passes', () => {
  assert.deepEqual(rules('const a = 1;\nexport { a }'), [])
})

test('flags server-only env names with line numbers', () => {
  const found = scanContent('a.js', 'ok\nlet x = process.env.DATABASE_URL')
  assert.deepEqual(found, [{ file: 'a.js', line: 2, rule: 'server-env-name' }])
  for (const name of [
    'BETTER_AUTH_SECRET',
    'S3_SECRET_KEY',
    'DOKPLOY_API_KEY',
    'SMTP_HOST',
    'SETUP_TOKEN',
    'METRICS_TOKEN',
  ]) {
    assert.deepEqual(rules(`x("${name}")`), ['server-env-name'], name)
  }
})

test('does not match names embedded in longer identifiers', () => {
  assert.deepEqual(rules('const MY_DATABASE_URL_LABEL = 1'), [])
})

test('flags connection strings, private keys and pg imports', () => {
  assert.deepEqual(rules('"postgres://u:p@db:5432/x"'), ['database-url'])
  assert.deepEqual(rules('"postgresql://u@h/d"'), ['database-url'])
  assert.deepEqual(rules('"redis://cache:6379"'), ['redis-url'])
  assert.deepEqual(rules('-----BEGIN RSA PRIVATE KEY-----'), ['private-key'])
  assert.deepEqual(rules('-----BEGIN PRIVATE KEY-----'), ['private-key'])
  assert.deepEqual(rules('import{Pool}from"pg";'), ['pg-import'])
  assert.deepEqual(rules("const pg = require('pg')"), ['pg-import'])
  assert.deepEqual(rules('import "drizzle-orm/node-postgres"'), ['pg-import'])
})

test('does not flag unrelated words that start with pg', () => {
  assert.deepEqual(rules('import x from "pgn-parser"'), [])
})

test('flags env values without echoing them', () => {
  const secret = 'super-secret-value-123'
  const found = scanContent('a.js', `var k="${secret}"`, {
    BETTER_AUTH_SECRET: secret,
    S3_SECRET_KEY: 'short',
  })
  assert.deepEqual(found, [
    { file: 'a.js', line: 1, rule: 'server-env-value:BETTER_AUTH_SECRET' },
  ])
  assert.ok(!JSON.stringify(found).includes(secret))
})

test('better-auth lazy env getters are tolerated', () => {
  const code =
    'Object.freeze({get BETTER_AUTH_SECRET(){return h(`BETTER_AUTH_SECRET`)}})'
  assert.deepEqual(rules(code), [])
  assert.deepEqual(rules(code + ';x=process.env.BETTER_AUTH_SECRET'), [
    'server-env-name',
  ])
})

test('minified env readers with a $ in their helper name are tolerated', () => {
  // The shape the production build emits: the helper is `a$`, not `h`.
  const code =
    'Object.freeze({get BETTER_AUTH_SECRET(){return a$(`BETTER_AUTH_SECRET`)},get AUTH_SECRET(){return a$(`AUTH_SECRET`)}})'
  assert.deepEqual(rules(code), [])
  // A getter that reads a different variable than the one it is named after
  // is not the benign shape.
  assert.deepEqual(
    rules('Object.freeze({get DATABASE_URL(){return a$(`REDIS_URL`)}})'),
    ['server-env-name'],
  )
})

test('scans a directory recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'ok.js'), 'export default 1')
  writeFileSync(join(dir, 'assets', 'bad.js'), 'x="postgres://a:b@c/d"')
  writeFileSync(join(dir, 'logo.png'), 'DATABASE_URL')
  const { files, findings } = scanDirectory(dir, {})
  assert.equal(files, 2)
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line}:${f.rule}`),
    ['assets/bad.js:1:database-url'],
  )
})
