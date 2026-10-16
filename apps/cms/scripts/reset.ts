import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'

import { pool } from '#/db'
import * as schema from '#/db/schema'

// Every table the schema declares, so a new table is wiped without editing
// this file. TRUNCATE ... CASCADE over one statement is FK-safe.
const tableNames = Object.values(schema).flatMap((value) =>
  is(value, PgTable) ? [getTableConfig(value).name] : [],
)

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
