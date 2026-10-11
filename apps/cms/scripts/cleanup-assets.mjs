#!/usr/bin/env node
import { Pool } from 'pg'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

if (!process.env.DATABASE_URL || !process.env.S3_BUCKET)
  throw new Error('DATABASE_URL and S3_BUCKET are required')
if (process.argv.slice(2).some((arg) => arg !== '--retry-paused'))
  throw new Error('Usage: cleanup-assets.mjs [--retry-paused]')
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
const retryDelays = [60_000, 300_000, 900_000]
let deleted = 0
let failed = 0
try {
  if (process.argv.includes('--retry-paused'))
    await pool.query(
      'UPDATE storage_object_deletion SET attempts=0, next_attempt_at=NULL, last_error=NULL WHERE attempts>=4',
    )
  // A committed upload may have lost its response; retain its owned object.
  await pool.query(`DELETE FROM storage_object_deletion d WHERE EXISTS
    (SELECT 1 FROM asset a WHERE a.storage_key=d.storage_key) OR EXISTS
    (SELECT 1 FROM branding b WHERE b.logo_key=d.storage_key OR b.favicon_key=d.storage_key)`)
  for (let i = 0; i < 1000; i++) {
    const { rows } = await pool.query(`WITH candidate AS (
      SELECT storage_key FROM storage_object_deletion
      WHERE attempts<4 AND (next_attempt_at IS NULL OR next_attempt_at<=now())
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE storage_object_deletion SET attempts=attempts+1,
      next_attempt_at=now()+interval '60 seconds'
      WHERE storage_key=(SELECT storage_key FROM candidate) RETURNING storage_key,attempts`)
    const job = rows[0]
    if (!job) break
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: job.storage_key,
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      )
      await pool.query(
        'DELETE FROM storage_object_deletion WHERE storage_key=$1 AND attempts=$2',
        [job.storage_key, job.attempts],
      )
      deleted++
    } catch (error) {
      failed++
      const delay = retryDelays[job.attempts - 1]
      await pool.query(
        'UPDATE storage_object_deletion SET last_error=$3,next_attempt_at=$4 WHERE storage_key=$1 AND attempts=$2',
        [
          job.storage_key,
          job.attempts,
          error.message,
          delay === undefined ? null : new Date(Date.now() + delay),
        ],
      )
    }
  }
  const { rows } = await pool.query(
    'SELECT count(*) AS n FROM storage_object_deletion WHERE attempts>=4',
  )
  console.log(
    `Storage cleanup: ${deleted} removed, ${failed} failed this run, ${rows[0].n} paused (use --retry-paused after fixing storage)`,
  )
  if (failed) process.exitCode = 1
} finally {
  await pool.end()
  s3.destroy()
}
