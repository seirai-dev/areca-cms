import { describe, expect, it } from 'vitest'
import { createS3Storage } from './s3'

describe.skipIf(!process.env.S3_ENDPOINT)('s3 storage', () => {
  const storage = createS3Storage({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'areca',
    prefix: process.env.S3_PREFIX,
    accessKey: process.env.S3_ACCESS_KEY ?? 'rustfsadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'rustfsadmin',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  })

  it('puts, gets, and deletes an object', async () => {
    const key = `adapter-test/${Date.now()}.txt`
    const payload = Buffer.from('areca-s3-roundtrip', 'utf8')

    await storage.put(key, payload, 'text/plain')
    const got = await storage.get(key)
    expect(got).not.toBeNull()
    const bytes = new Uint8Array(await new Response(got!.body).arrayBuffer())
    expect(Buffer.from(bytes).equals(payload)).toBe(true)
    expect(got?.contentType).toMatch(/text\/plain/)
    expect(got?.contentLength).toBe(payload.byteLength)

    await storage.delete(key)
    expect(await storage.get(key)).toBeNull()
  })

  it('reads a multi-chunk object to the end', async () => {
    const key = `adapter-test/${Date.now()}-large.bin`
    const payload = Buffer.alloc(3 * 1024 * 1024, 7)

    await storage.put(key, payload, 'application/octet-stream')
    try {
      const got = await storage.get(key)
      expect(got).not.toBeNull()
      const reader = got!.body.getReader()
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
      }
      expect(received).toBe(payload.byteLength)
    } finally {
      await storage.delete(key)
    }
  })
})
