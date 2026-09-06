import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { AssetStorageAdapter } from './types'

export function createS3Storage(opts: {
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
  forcePathStyle: boolean
}): AssetStorageAdapter {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKey,
      secretAccessKey: opts.secretKey,
    },
    forcePathStyle: opts.forcePathStyle,
  })

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      )
    },

    async get(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
        )
        if (!res.Body) return null
        const body = Buffer.from(await res.Body.transformToByteArray())
        return { body, contentType: res.ContentType }
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },

    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }),
      )
    },
  }
}

function isNotFound(err: unknown) {
  const name = (err as { name?: string } | undefined)?.name
  return name === 'NoSuchKey' || name === 'NotFound'
}
