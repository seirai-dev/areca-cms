#!/usr/bin/env node
import { Pool } from 'pg'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

if (!process.env.DATABASE_URL || !process.env.S3_BUCKET)
  throw new Error('DATABASE_URL and S3_BUCKET are required')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
})
let deleted = 0
let failed = 0
try {
  const { rows } = await pool.query(
    'SELECT storage_key FROM storage_object_deletion ORDER BY created_at LIMIT 1000',
  )
  for (const { storage_key: key } of rows) {
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      )
      await pool.query(
        'DELETE FROM storage_object_deletion WHERE storage_key=$1',
        [key],
      )
      deleted++
    } catch (error) {
      failed++
      await pool.query(
        'UPDATE storage_object_deletion SET last_error=$2 WHERE storage_key=$1',
        [key, error.message],
      )
    }
  }
  console.log(`Storage cleanup: ${deleted} removed, ${failed} pending retries`)
  if (failed) process.exitCode = 1
} finally {
  await pool.end()
  s3.destroy()
}
