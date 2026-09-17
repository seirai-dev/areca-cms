import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { getTableConfig } from 'drizzle-orm/pg-core'

import { pool } from '#/db'
import {
  account,
  asset,
  auditLog,
  branding,
  buildJob,
  collection,
  dokployCredential,
  entry,
  entryRevision,
  invitation,
  membership,
  organization,
  publication,
  session,
  site,
  user,
  verification,
} from '#/db/schema'

const tables = [
  auditLog,
  branding,
  buildJob,
  publication,
  asset,
  entryRevision,
  entry,
  collection,
  site,
  dokployCredential,
  invitation,
  membership,
  organization,
  verification,
  account,
  session,
  user,
]

const tableNames = tables.map((table) => getTableConfig(table).name)

const bucket = process.env.S3_BUCKET
if (!bucket) {
  throw new Error('S3_BUCKET is required')
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
})

async function emptyBucket() {
  let deleted = 0
  let token: string | undefined

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
      }),
    )
    const objects = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }))

    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      )
      deleted += objects.length
    }

    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token)

  return deleted
}

try {
  const quoted = tableNames.map((name) => `"${name}"`).join(', ')
  await pool.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`)
  console.log(`Truncated ${tableNames.length} tables (schema kept):`)
  for (const name of tableNames) {
    console.log(`  - ${name}`)
  }

  const deleted = await emptyBucket()
  console.log(`Emptied S3 bucket "${bucket}": deleted ${deleted} object(s).`)
  console.log('Reset complete. Run `pnpm db:seed` if you want the demo data.')
} finally {
  await pool.end()
}
