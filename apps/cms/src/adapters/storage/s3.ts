import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { abortAfter, explainAbort, idleGuard } from './timeouts'
import { createS3Namespace } from './s3-namespace.mjs'
import type { AssetStorageAdapter } from './types'

/** Longest wait for S3 to send a GET's headers, and for each body chunk after. */
const GET_TIMEOUT_MS = 30_000
const PUT_TIMEOUT_MS = 60_000
const DELETE_TIMEOUT_MS = 30_000

export function createS3Storage(opts: {
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
  forcePathStyle: boolean
  prefix?: string
  /** Overrides the GET wait limit; tests use a short one. */
  getTimeoutMs?: number
}): AssetStorageAdapter {
  const namespace = createS3Namespace(opts.prefix)
  const getTimeoutMs = opts.getTimeoutMs ?? GET_TIMEOUT_MS
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
          Key: namespace.objectKey(key),
          Body: body,
          ContentType: contentType,
        }),
        { abortSignal: AbortSignal.timeout(PUT_TIMEOUT_MS) },
      )
    },

    async get(key, call) {
      const physicalKey = namespace.objectKey(key)
      // One controller covers the request and the body. Aborting it, by the
      // caller, a timeout or a cancelled stream, closes the connection.
      const controller = new AbortController()
      const onCallerAbort = () => controller.abort(call?.signal?.reason)
      const detach = () =>
        call?.signal?.removeEventListener('abort', onCallerAbort)
      call?.signal?.addEventListener('abort', onCallerAbort, { once: true })

      const headersTimer = abortAfter(
        controller,
        getTimeoutMs,
        `S3 did not send ${key} within ${getTimeoutMs / 1000}s`,
      )
      let response
      try {
        response = await client.send(
          new GetObjectCommand({ Bucket: opts.bucket, Key: physicalKey }),
          { abortSignal: controller.signal },
        )
      } catch (err) {
        detach()
        if (isNotFound(err)) return null
        throw explainAbort(controller, err)
      } finally {
        clearTimeout(headersTimer)
      }

      if (!response.Body) {
        detach()
        return null
      }
      return {
        body: idleGuard(
          response.Body.transformToWebStream(),
          controller,
          getTimeoutMs,
          detach,
        ),
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      }
    },

    async delete(key, call) {
      const timeout = AbortSignal.timeout(DELETE_TIMEOUT_MS)
      await client.send(
        new DeleteObjectCommand({
          Bucket: opts.bucket,
          Key: namespace.objectKey(key),
        }),
        {
          abortSignal: call?.signal
            ? AbortSignal.any([timeout, call.signal])
            : timeout,
        },
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
