import { env } from '#/env'
import { createS3Storage } from './storage/s3'
import type { AssetStorageAdapter } from './storage/types'

// Configuration comes from immutable env, so one adapter (and one S3Client with
// its keep-alive socket pool) serves the whole process. Per-call deadlines are
// passed to each request, not stored on the client.
let storage: AssetStorageAdapter | undefined

export function getStorage(): AssetStorageAdapter {
  storage ??= createS3Storage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    prefix: env.S3_PREFIX,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  })
  return storage
}
