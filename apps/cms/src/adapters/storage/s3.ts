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
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
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
        { abortSignal: AbortSignal.timeout(60_000) },
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
        { abortSignal: AbortSignal.timeout(30_000) },
      )
    },
  }
}

function isNotFound(err: unknown) {
  if (!err || typeof err !== 'object') return false
  const record = err as {
    name?: string
    Code?: string
    code?: string
    $metadata?: { httpStatusCode?: number }
  }
  if (record.$metadata?.httpStatusCode === 404) return true
  const codes = [record.name, record.Code, record.code]
  return codes.some(
    (code) => code === 'NoSuchKey' || code === 'NotFound' || code === '404',
  )
}
