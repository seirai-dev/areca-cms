#!/usr/bin/env node
// Operator-only CLI. Run with CMS/worker writes stopped; never expose this as an HTTP endpoint.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'

export const tables = [
  'organization',
  'dokploy_credential',
  'site',
  'collection',
  'entry',
  'entry_revision',
  'asset',
  'membership',
  'invitation',
  'publication',
  'build_job',
  'audit_log',
  'deleted_content_archive',
]
const userColumns = [
  'user_id',
  'created_by',
  'updated_by',
  'requested_by',
  'actor_id',
]
const archivedActorKeys = new Set([
  ...userColumns,
  'userId',
  'createdBy',
  'updatedBy',
  'requestedBy',
  'actorId',
])
/** Archived row metadata includes camelCase Drizzle rows and snake_case SQL rows. */
export function transformArchivedActors(value, transform) {
  if (Array.isArray(value))
    return value.map((item) => transformArchivedActors(item, transform))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        archivedActorKeys.has(key) && typeof item === 'string'
          ? transform(item)
          : transformArchivedActors(item, transform),
      ]),
    )
  }
  return value
}
const sha = (value) => createHash('sha256').update(value).digest('hex')
export function validateBundle(bundle, schema) {
  if (bundle.format !== 'areca-organization' || bundle.version !== 1)
    throw new Error('Unsupported authoring bundle version')
  if (JSON.stringify(bundle.schema) !== JSON.stringify(schema))
    throw new Error(
      'Database schema differs; migrate to the exporter version before import',
    )
  if (
    !bundle.rows ||
    tables.some((table) => !Array.isArray(bundle.rows[table]))
  )
    throw new Error('Incomplete bundle')
  const org = bundle.rows.organization
  if (org.length !== 1 || typeof org[0].id !== 'string')
    throw new Error('Expected one organization')
  const ids = (table) => new Set(bundle.rows[table].map((row) => row.id))
  const sites = ids('site'),
    collections = ids('collection'),
    entries = ids('entry'),
    publications = ids('publication')
  for (const table of tables)
    for (const row of bundle.rows[table]) {
      if (Object.keys(row).some((key) => !schema[table].includes(key)))
        throw new Error(`Unknown columns in ${table}`)
      if ('organization_id' in row && row.organization_id !== org[0].id)
        throw new Error('Cross-organization row')
      if (row.site_id && !sites.has(row.site_id))
        throw new Error('Foreign site reference')
      if (row.collection_id && !collections.has(row.collection_id))
        throw new Error('Foreign collection reference')
      if (row.entry_id && !entries.has(row.entry_id))
        throw new Error('Foreign entry reference')
      if (row.publication_id && !publications.has(row.publication_id))
        throw new Error('Foreign publication reference')
    }
  const keys = new Set()
  for (const row of bundle.rows.asset) {
    if (keys.has(row.storage_key)) throw new Error('Duplicate object key')
    keys.add(row.storage_key)
    const object = bundle.objects?.[row.storage_key]
    if (
      !object ||
      typeof object.base64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        object.base64,
      )
    )
      throw new Error('Missing/invalid asset bytes')
    const bytes = Buffer.from(object.base64, 'base64')
    if (sha(bytes) !== object.sha256 || bytes.length !== row.size)
      throw new Error('Asset integrity mismatch')
  }
  if (Object.keys(bundle.objects ?? {}).some((key) => !keys.has(key)))
    throw new Error('Unexpected object')
  if (
    bundle.rows.build_job.some((row) =>
      ['validating', 'building', 'deploying'].includes(row.status),
    )
  )
    throw new Error(
      'Active jobs cannot be transferred; stop and recover/cancel them first',
    )
}

export function rebaseAssetUrls(value, keys, appUrl) {
  if (typeof value === 'string') {
    try {
      const parsed = new URL(value)
      const prefix = '/api/assets/file/'
      if (
        parsed.pathname.startsWith(prefix) &&
        keys.has(decodeURIComponent(parsed.pathname.slice(prefix.length)))
      ) {
        return new URL(parsed.pathname + parsed.search, appUrl).toString()
      }
    } catch {}
    return value
  }
  if (Array.isArray(value))
    return value.map((item) => rebaseAssetUrls(item, keys, appUrl))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rebaseAssetUrls(item, keys, appUrl),
      ]),
    )
  return value
}

async function main() {
  const [command, value, file] = process.argv.slice(2)
  if (!['export', 'import'].includes(command) || !value || !file)
    throw new Error(
      'Usage: authoring-transfer.mjs export ORG_ID FILE | import --offline FILE (CMS/workers must be stopped)',
    )
  if (command === 'import' && value !== '--offline')
    throw new Error('Import requires --offline acknowledgement')
  if (process.env.ARECA_WRITES_STOPPED !== '1')
    throw new Error(
      'Stop all CMS/worker writers and set ARECA_WRITES_STOPPED=1',
    )
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  })
  const bucket = process.env.S3_BUCKET
  const uploaded = []
  let commitAttempted = false
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const schema = {}
    for (const table of tables) {
      schema[table] = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [table],
        )
      ).rows.map((r) => r.column_name)
      if (!schema[table].length) throw new Error(`Missing table ${table}`)
    }
    if (command === 'export') {
      const rows = {}
      for (const table of tables) {
        const condition =
          table === 'organization'
            ? 'id = $1'
            : ['collection', 'entry', 'publication', 'build_job'].includes(
                  table,
                )
              ? 'site_id IN (SELECT id FROM site WHERE organization_id = $1)'
              : table === 'entry_revision'
                ? 'entry_id IN (SELECT e.id FROM entry e JOIN site s ON e.site_id = s.id WHERE s.organization_id = $1)'
                : 'organization_id = $1'
        rows[table] = (
          await client.query(`SELECT * FROM "${table}" WHERE ${condition}`, [
            value,
          ])
        ).rows
      }
      const referencedUsers = new Set()
      for (const list of Object.values(rows))
        for (const row of list)
          for (const key of userColumns)
            if (row[key]) referencedUsers.add(row[key])
      for (const archive of rows.deleted_content_archive)
        transformArchivedActors(archive.data, (id) => {
          referencedUsers.add(id)
          return id
        })
      const users = (
        await client.query(
          'SELECT id, email FROM "user" WHERE id = ANY($1::text[])',
          [[...referencedUsers]],
        )
      ).rows
      const objects = Object.create(null)
      for (const row of rows.asset) {
        const response = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: row.storage_key }),
        )
        const bytes = Buffer.from(await response.Body.transformToByteArray())
        objects[row.storage_key] = {
          base64: bytes.toString('base64'),
          sha256: sha(bytes),
          contentType: row.mime_type,
        }
      }
      const bundle = {
        format: 'areca-organization',
        version: 1,
        createdAt: new Date().toISOString(),
        schema,
        rows,
        users,
        objects,
        encryptionKey: process.env.DOKPLOY_CREDENTIALS_ENCRYPTION_KEY,
      }
      validateBundle(bundle, schema)
      if (rows.dokploy_credential.length && !bundle.encryptionKey)
        throw new Error('Deployment encryption key required')
      await writeFile(file, JSON.stringify(bundle), { mode: 0o600, flag: 'wx' })
    } else {
      const bundle = JSON.parse(await readFile(file, 'utf8'))
      validateBundle(bundle, schema)
      if (
        bundle.rows.dokploy_credential.length &&
        bundle.encryptionKey !== process.env.DOKPLOY_CREDENTIALS_ENCRYPTION_KEY
      )
        throw new Error(
          'Deployment encryption key differs; import into an isolated instance using the preserved key',
        )
      const userMap = new Map()
      for (const user of bundle.users ?? []) {
        const existing = (
          await client.query(
            'SELECT id FROM "user" WHERE lower(email) = lower($1)',
            [user.email],
          )
        ).rows
        if (existing.length !== 1)
          throw new Error(
            `Provision exactly one destination user for ${user.email} before importing permissions/history`,
          )
        userMap.set(user.id, existing[0].id)
      }
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ['assets:' + bundle.rows.organization[0].id],
      )
      for (const row of bundle.rows.asset) {
        const queued = await client.query(
          'SELECT 1 FROM storage_object_deletion WHERE storage_key = $1 LIMIT 1',
          [row.storage_key],
        )
        if (queued.rows.length)
          throw new Error(`Object is queued for deletion: ${row.storage_key}`)
      }
      // Object collision checks precede any writes. Offline import prevents concurrent puts.
      for (const row of bundle.rows.asset) {
        try {
          await s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: row.storage_key }),
          )
          throw new Error(`Object already exists: ${row.storage_key}`)
        } catch (error) {
          if (
            error.$metadata?.httpStatusCode !== 404 &&
            !['NotFound', 'NoSuchKey'].includes(error.name)
          )
            throw error
        }
      }
      for (const table of tables)
        for (const original of bundle.rows[table]) {
          const row = { ...original }
          if (
            process.env.APP_URL &&
            ['entry', 'entry_revision'].includes(table)
          ) {
            const assetKeys = new Set(
              bundle.rows.asset.map((asset) => asset.storage_key),
            )
            for (const column of [
              'draft_data',
              'published_data',
              'scheduled_data',
              'data',
            ]) {
              if (row[column])
                row[column] = rebaseAssetUrls(
                  row[column],
                  assetKeys,
                  process.env.APP_URL,
                )
            }
          }
          for (const key of userColumns)
            if (row[key]) {
              if (!userMap.has(row[key]))
                throw new Error(`Missing user mapping: ${row[key]}`)
              row[key] = userMap.get(row[key])
            }
          if (table === 'deleted_content_archive')
            row.data = transformArchivedActors(
              row.data,
              (id) => userMap.get(id) ?? null,
            )
          // Imported sites are offline demos with new credentials; integration secrets never survive portability.
          if (table === 'site') {
            row.token_hash = sha(randomBytes(32))
            row.schema_token_hash = null
            row.preview_secret = randomBytes(32).toString('hex')
            row.publishing_mode = 'demo'
            row.deployment_target = null
          }
          if (table === 'publication') {
            // Historical deployment evidence belongs to the source instance only.
            row.status = 'superseded'
            row.was_live = false
            row.deployed_at = null
          }
          if (table === 'build_job' && row.status === 'queued') {
            row.status = 'cancelled'
            row.finished_at = new Date().toISOString()
            row.error =
              'Imported historical queue; request a new release at the destination'
          }
          if (table === 'invitation') {
            row.token = randomBytes(32).toString('hex')
            row.expires_at = new Date(0).toISOString()
          }
          const columns = Object.keys(row)
          const values = columns.map((key) =>
            row[key] && typeof row[key] === 'object'
              ? JSON.stringify(row[key])
              : row[key],
          )
          await client.query(
            `INSERT INTO "${table}" (${columns.map((key) => `"${key}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
            values,
          )
        }
      for (const source of bundle.rows.publication) {
        await client.query(
          'INSERT INTO audit_log (id, organization_id, site_id, actor_id, action, target_type, target_id, meta) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)',
          [
            randomBytes(16).toString('hex'),
            bundle.rows.organization[0].id,
            source.site_id,
            'publication.import',
            'publication',
            source.id,
            JSON.stringify({
              sourceStatus: source.status,
              sourceWasLive: source.was_live,
              sourceDeployedAt: source.deployed_at,
              sourceJobs: bundle.rows.build_job
                .filter((job) => job.publication_id === source.id)
                .map((job) => ({ id: job.id, status: job.status })),
            }),
          ],
        )
      }
      for (const row of bundle.rows.asset) {
        const object = bundle.objects[row.storage_key]
        // Track before put to compensate even an ambiguous network failure after a successful write.
        uploaded.push(row.storage_key)
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: row.storage_key,
            Body: Buffer.from(object.base64, 'base64'),
            ContentType: object.contentType,
          }),
        )
      }
    }
    commitAttempted = true
    await client.query('COMMIT')
    console.log(`${command} complete: ${file}`)
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {}
    if (commitAttempted && uploaded.length)
      console.error(
        'Commit outcome uncertain. Preserve uploaded objects; inspect destination rows before retrying.',
      )
    for (const key of commitAttempted ? [] : uploaded) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      } catch (cleanup) {
        console.error(`Cleanup required for ${key}: ${cleanup.message}`)
      }
    }
    throw error
  } finally {
    client.release()
    await pool.end()
    s3.destroy()
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
