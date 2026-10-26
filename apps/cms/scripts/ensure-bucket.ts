import { S3Client } from '@aws-sdk/client-s3'

import { ensureBucket } from './lib/ensure-bucket.mjs'
import { createS3Namespace } from '../src/adapters/storage/s3-namespace.mjs'

createS3Namespace(process.env.S3_PREFIX)

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

// Fails without creating anything unless the bucket is definitively missing.
await ensureBucket(client, bucket)
