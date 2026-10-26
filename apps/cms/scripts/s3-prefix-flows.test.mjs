import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { tables } from './authoring-transfer.mjs'

const key = 'org/asset'
const bytes = Buffer.from('test asset')
const schema = Object.fromEntries(
  tables.map((table) => [
    table,
    ['id', 'organization_id', 'storage_key', 'size', 'mime_type'],
  ]),
)
const rows = Object.fromEntries(tables.map((table) => [table, []]))
rows.organization = [{ id: 'org' }]
rows.asset = [
  {
    id: 'asset',
    organization_id: 'org',
    storage_key: key,
    size: bytes.length,
    mime_type: 'image/png',
  },
]
const bundle = {
  format: 'areca-organization',
  version: 1,
  schema,
  rows,
  users: [],
  objects: {
    [key]: {
      base64: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: 'image/png',
    },
  },
}

// Run the real entrypoints in child processes with ESM dependency replacements.
// No production seams, source-text assertions, local env reads, network, or DB.
// Events capture the observable AWS commands, SQL parameters and spawned env.
function run(
  script,
  {
    prefix,
    e2ePrefix,
    command,
    failPut = false,
    collision = false,
    rootOnly = false,
    escapedListing = false,
    deleteError = false,
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'areca-prefix-test-'))
  const file = join(dir, 'bundle.json')
  if (command === 'import') writeFileSync(file, JSON.stringify(bundle))
  const config = {
    schema,
    rows,
    key,
    bytes: bytes.toString('base64'),
    failPut,
    collision,
    rootOnly,
    escapedListing,
    deleteError,
  }
  const pg = `
    const cfg = ${JSON.stringify(config)};
    let claimed = false;
    class Client {
      async connect() {} release() {} async end() {}
      async query(sql, params) {
        console.log('EVENT ' + JSON.stringify({type:'sql', sql, params}));
        if (sql.includes('information_schema.columns')) return {rows: cfg.schema[params[0]].map(column_name => ({column_name}))};
        const table = sql.match(/^SELECT \\* FROM "([^"]+)"/)?.[1];
        if (table) return {rows:cfg.rows[table]};
        if (sql.includes('RETURNING storage_key,attempts') && !claimed) {claimed=true; return {rows:[{storage_key:cfg.key,attempts:1}]};}
        if (sql.includes('count(*)')) return {rows:[{n:0}]};
        return {rows:[],rowCount:1};
      }
    }
    export class Pool extends Client {async connect(){return new Client()}}
    export default {Client,Pool};`
  const aws = `
    const cfg = ${JSON.stringify(config)};
    export class PutObjectCommand { constructor(input){this.input=input} }
    export class GetObjectCommand { constructor(input){this.input=input} }
    export class HeadObjectCommand { constructor(input){this.input=input} }
    export class DeleteObjectCommand { constructor(input){this.input=input} }
    export class ListObjectsV2Command { constructor(input){this.input=input} }
    export class DeleteObjectsCommand { constructor(input){this.input=input} }
    export class HeadBucketCommand { constructor(input){this.input=input} }
    export class CreateBucketCommand { constructor(input){this.input=input} }
    export class S3Client {
      destroy() {}
      async send(cmd) {
        const name=cmd.constructor.name, input=cmd.input;
        console.log('EVENT '+JSON.stringify({type:'s3',name,input}));
        if (name==='GetObjectCommand') {
          if (cfg.rootOnly && input.Key !== cfg.key) throw Object.assign(new Error('missing'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});
          return {Body:{transformToByteArray:async()=>Buffer.from(cfg.bytes,'base64')}};
        }
        if (name==='HeadObjectCommand' && !cfg.collision) throw Object.assign(new Error('missing'),{name:'NotFound',$metadata:{httpStatusCode:404}});
        if (name==='PutObjectCommand' && cfg.failPut) throw new Error('ambiguous put failure');
        if (name==='DeleteObjectsCommand' && cfg.deleteError) return {Errors:[{Key:input.Delete.Objects[0].Key,Code:'AccessDenied'}]};
        if (name==='ListObjectsV2Command') {
          // Faithful prefix filtering: sibling prefixes and root are never part
          // of a scoped listing. Page two includes a manually placed object.
          const all=['org/asset','tenant/prod/org/asset','tenant/prod/manual.txt','tenant/prod2/keep','tenant/production/keep'];
          const selected=all.filter(key=>!input.Prefix || key.startsWith(input.Prefix));
          if (cfg.escapedListing) selected.push('tenant/prod2/escaped');
          const offset=input.ContinuationToken?1:0;
          return {Contents:selected.slice(offset,offset?undefined:1).map(Key=>({Key})),IsTruncated:!offset,NextContinuationToken:offset?undefined:'page-2'};
        }
        return {};
      }
    }`
  const replacements = {
    pg,
    '@aws-sdk/client-s3': aws,
    'drizzle-orm': 'export function is(){return true}',
    'drizzle-orm/pg-core':
      'export class PgTable {}; export function getTableConfig(){return {name:"asset"}}',
    '#/db': `import {Pool} from 'pg';export const pool=new Pool()`,
    '#/db/schema': 'export const asset={}',
    '#/lib/zod': `export {z} from ${JSON.stringify(import.meta.resolve('zod'))}`,
    '#/lib/secret-placeholders':
      'export function productionSecretProblems(){return []}',
    dotenv: 'export function config(){}',
    'drizzle-orm/node-postgres': 'export function drizzle(){return {}}',
    'drizzle-orm/node-postgres/migrator':
      'export async function migrate(){console.log(\'EVENT {"type":"migration"}\')}',
    redis:
      'export function createClient(){return {on(){},async connect(){},async *scanIterator(){},async quit(){}}}',
  }
  if (script === 'e2e-isolated.mjs') {
    replacements['node:fs'] =
      'export function existsSync(){return false}; export function readFileSync(){throw new Error("Forbidden local environment read")}'
    replacements['node:child_process'] =
      `export function spawnSync(command,args,options){console.log('EVENT '+JSON.stringify({type:'spawn',command,args,env:{S3_PREFIX:options.env.S3_PREFIX,S3_BUCKET:options.env.S3_BUCKET}}));return {status:0}}`
  }
  const loader = `
    import {registerHooks} from 'node:module';
    const replacements=${JSON.stringify(replacements)};
    registerHooks({resolve(specifier,context,next){
      if (Object.hasOwn(replacements,specifier)) return {url:'data:text/javascript,'+encodeURIComponent(replacements[specifier]),shortCircuit:true};
      return next(specifier,context);
    }});`
  // Explicit allowlist: don't pass inherited credentials or environment config.
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    S3_BUCKET: 'test-bucket',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_ACCESS_KEY: 'fake-access',
    S3_SECRET_KEY: 'fake-secret',
    DATABASE_URL: 'postgres://fake:fake@127.0.0.1:1/dev',
    E2E_DATABASE_URL: 'postgres://fake:fake@127.0.0.1:1/test',
    ARECA_WRITES_STOPPED: '1',
    SKIP_ENV_VALIDATION: 'true',
  }
  if (prefix !== undefined) env.S3_PREFIX = prefix
  if (e2ePrefix !== undefined) env.E2E_S3_PREFIX = e2ePrefix
  const args = command
    ? [command, command === 'import' ? '--offline' : 'org', file]
    : []
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'data:text/javascript,' + encodeURIComponent(loader),
        new URL(script, import.meta.url).pathname,
        ...args,
      ],
      { env, encoding: 'utf8', timeout: 15_000 },
    )
    if (result.error) throw result.error
    const events = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('EVENT '))
      .map((line) => JSON.parse(line.slice(6)))
    return {
      ...result,
      events,
      s3: events.filter((event) => event.type === 's3'),
      exported:
        command === 'export' && existsSync(file)
          ? JSON.parse(readFileSync(file, 'utf8'))
          : undefined,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
function success(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
}
function commands(result) {
  return result.s3.map(({ name, input }) => [name, input.Key])
}

for (const prefix of [undefined, '', '/tenant/prod/']) {
  const physical = prefix ? `tenant/prod/${key}` : key
  test(`transfer export uses scoped GET, retains logical bundle key (${JSON.stringify(prefix)})`, () => {
    const result = run('authoring-transfer.mjs', { command: 'export', prefix })
    success(result)
    assert.deepEqual(Object.keys(result.exported.objects), [key])
    assert.equal(result.exported.rows.asset[0].storage_key, key)
    assert.equal(result.exported.objects[key].base64, bytes.toString('base64'))
    assert.deepEqual(commands(result), [['GetObjectCommand', physical]])
    // SQL lookup stays logical; no prefix is introduced into row selection.
    assert.ok(
      result.events.some((e) => e.type === 'sql' && e.params?.[0] === 'org'),
    )
  })
  test(`transfer import collision HEAD and PUT use same boundary (${JSON.stringify(prefix)})`, () => {
    const result = run('authoring-transfer.mjs', { command: 'import', prefix })
    success(result)
    assert.deepEqual(commands(result), [
      ['HeadObjectCommand', physical],
      ['PutObjectCommand', physical],
    ])
    const insert = result.events.find(
      (e) => e.type === 'sql' && e.sql.startsWith('INSERT INTO "asset"'),
    )
    assert.equal(insert.params[2], key)
  })
  test(`transfer ambiguous PUT compensates only the scoped key (${JSON.stringify(prefix)})`, () => {
    const result = run('authoring-transfer.mjs', {
      command: 'import',
      prefix,
      failPut: true,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ambiguous put failure/)
    assert.deepEqual(commands(result), [
      ['HeadObjectCommand', physical],
      ['PutObjectCommand', physical],
      ['DeleteObjectCommand', physical],
    ])
  })
  test(`standalone cleanup deletes scoped object but acknowledges logical DB key (${JSON.stringify(prefix)})`, () => {
    const result = run('cleanup-assets.mjs', { prefix })
    success(result)
    assert.deepEqual(commands(result), [['DeleteObjectCommand', physical]])
    assert.ok(
      result.events.some(
        (e) =>
          e.type === 'sql' &&
          e.sql.startsWith('DELETE FROM storage_object_deletion WHERE') &&
          e.params[0] === key,
      ),
    )
  })
  test(`reset paginates and deletes entire selected subtree (${JSON.stringify(prefix)})`, () => {
    const result = run('reset.ts', { prefix })
    success(result)
    const lists = result.s3.filter((e) => e.name === 'ListObjectsV2Command')
    assert.equal(lists.length, 2)
    assert.deepEqual(
      lists.map((e) => e.input.Prefix),
      [
        prefix ? 'tenant/prod/' : undefined,
        prefix ? 'tenant/prod/' : undefined,
      ],
    )
    assert.deepEqual(
      lists.map((e) => e.input.ContinuationToken),
      [undefined, 'page-2'],
    )
    const deleted = result.s3
      .filter((e) => e.name === 'DeleteObjectsCommand')
      .flatMap((e) => e.input.Delete.Objects.map((o) => o.Key))
    assert.deepEqual(
      deleted,
      prefix
        ? ['tenant/prod/org/asset', 'tenant/prod/manual.txt']
        : [
            'org/asset',
            'tenant/prod/org/asset',
            'tenant/prod/manual.txt',
            'tenant/prod2/keep',
            'tenant/production/keep',
          ],
    )
    assert.ok(result.s3.every((e) => e.input.Bucket === 'test-bucket'))
  })
}

test('export missing prefixed object fails without falling back to existing root object', () => {
  const result = run('authoring-transfer.mjs', {
    command: 'export',
    prefix: 'tenant/prod',
    rootOnly: true,
  })
  assert.notEqual(result.status, 0)
  assert.deepEqual(commands(result), [
    ['GetObjectCommand', 'tenant/prod/org/asset'],
  ])
})
test('import collision checks stop writes and compensation', () => {
  const result = run('authoring-transfer.mjs', {
    command: 'import',
    prefix: 'tenant/prod',
    collision: true,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Object already exists/)
  assert.deepEqual(commands(result), [
    ['HeadObjectCommand', 'tenant/prod/org/asset'],
  ])
})
test('reset never sends an out-of-scope deletion even if a listing contains one', () => {
  const result = run('reset.ts', {
    prefix: 'tenant/prod',
    escapedListing: true,
  })
  const deleted = result.s3
    .filter((event) => event.name === 'DeleteObjectsCommand')
    .flatMap((event) => event.input.Delete.Objects.map((object) => object.Key))
  assert.ok(
    deleted.every((key) => key.startsWith('tenant/prod/')),
    JSON.stringify(deleted),
  )
  assert.ok(result.s3.some((event) => event.name === 'ListObjectsV2Command'))
})
test('reset fails on per-object deletion errors and does not report success', () => {
  const result = run('reset.ts', { prefix: 'tenant/prod', deleteError: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /AccessDenied/)
  assert.doesNotMatch(result.stdout, /Reset complete/)
})
for (const prefix of [
  '/',
  ' ',
  'tenant//prod',
  'tenant/../prod',
  'tenant\\prod',
  'tenant\nprod',
]) {
  for (const [script, command] of [
    ['authoring-transfer.mjs', 'export'],
    ['authoring-transfer.mjs', 'import'],
    ['cleanup-assets.mjs'],
    ['reset.ts'],
    ['ensure-bucket.ts'],
    ['docker-entrypoint.mjs'],
    ['../src/env.ts'],
  ]) {
    test(`${script} ${command ?? ''} refuses invalid ${JSON.stringify(prefix)} before S3`, () => {
      const result = run(script, { command, prefix })
      assert.notEqual(
        result.status,
        0,
        'invalid nonempty config must fail, never become root',
      )
      assert.match(result.stderr, /prefix/i)
      assert.deepEqual(result.s3, [])
      assert.deepEqual(
        result.events.filter(
          (event) => event.type === 'sql' || event.type === 'migration',
        ),
        [],
      )
    })
  }
}
for (const prefix of [undefined, '', '/tenant/prod/']) {
  test(`environment accepts ${JSON.stringify(prefix)} when general validation is skipped`, () => {
    success(run('../src/env.ts', { prefix }))
  })
}
for (const e2ePrefix of [undefined, '', 'isolated/run-42']) {
  test(`isolated E2E ignores inherited S3_PREFIX, selects ${JSON.stringify(e2ePrefix)}`, () => {
    const result = run('e2e-isolated.mjs', {
      prefix: 'production/do-not-touch',
      e2ePrefix,
    })
    success(result)
    const spawns = result.events.filter((e) => e.type === 'spawn')
    assert.equal(spawns.length, 3)
    for (const event of spawns) {
      assert.equal(event.env.S3_PREFIX, e2ePrefix ?? '')
      assert.equal(event.env.S3_BUCKET, 'areca-e2e')
    }
  })
}
