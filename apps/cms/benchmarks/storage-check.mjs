// Build with esbuild (platform=node, format=cjs), then stream the bundle into
// the CMS container AFTER the capacity run. No credential leaves the container.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { randomBytes, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

async function main() {
  if (process.env.BENCH_STORAGE_CHECK !== 'YES')
    throw new Error('Explicit diagnostic opt-in required')
  const configured = process.env.S3_ENDPOINT
  const internal = process.env.BENCH_INTERNAL_S3
  const options = {
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }
  const data = randomBytes(444910),
    results = []
  for (const [name, endpoint, reuse] of [
    ['fresh-public', configured, false],
    ['reuse-public', configured, true],
    ...(internal
      ? [
          ['fresh-internal', internal, false],
          ['reuse-internal', internal, true],
        ]
      : []),
  ]) {
    const shared = reuse ? new S3Client({ ...options, endpoint }) : null
    const times = { put: [], get: [], delete: [] },
      errors = []
    async function operation(kind, command) {
      const start = performance.now(),
        client = shared || new S3Client({ ...options, endpoint })
      try {
        const result = await client.send(command, {
          abortSignal: AbortSignal.timeout(10000),
        })
        if (result.Body) await result.Body.transformToByteArray()
        times[kind].push(performance.now() - start)
      } catch (error) {
        errors.push({ operation: kind, name: error.name })
      } finally {
        if (!shared) client.destroy()
      }
    }
    for (let i = 0; i < 12; i++) {
      const prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '')
      const Key = `${prefix ? `${prefix}/` : ''}benchmark-diagnostics/${randomUUID()}.bin`,
        Bucket = process.env.S3_BUCKET
      try {
        await operation(
          'put',
          new PutObjectCommand({
            Bucket,
            Key,
            Body: data,
            ContentType: 'application/octet-stream',
          }),
        )
        await operation('get', new GetObjectCommand({ Bucket, Key }))
      } finally {
        await operation('delete', new DeleteObjectCommand({ Bucket, Key }))
      }
    }
    shared?.destroy()
    const describe = (values) => {
      values.sort((a, b) => a - b)
      const p = (n) => {
        if (!values.length) return null
        const i = (values.length - 1) * n
        return (
          values[Math.floor(i)] +
          (values[Math.ceil(i)] - values[Math.floor(i)]) * (i % 1)
        )
      }
      return {
        n: values.length,
        median: p(0.5),
        p95: p(0.95),
        max: values.at(-1),
      }
    }
    results.push({
      name,
      payloadBytes: data.length,
      ...Object.fromEntries(
        Object.entries(times).map(([k, v]) => [k, describe(v)]),
      ),
      errors,
    })
  }
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope: 'Sequential storage-path microcheck; not a capacity tier',
        results,
      },
      null,
      2,
    ),
  )
}
main().catch((error) => {
  console.log(JSON.stringify({ error: error.name }))
  process.exitCode = 1
})
