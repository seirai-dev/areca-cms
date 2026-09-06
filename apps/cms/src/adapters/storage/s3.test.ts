import { describe, expect, it } from 'vitest'
import { createS3Storage } from './s3'

describe.skipIf(!process.env.S3_ENDPOINT)('s3 storage', () => {
  it('puts, gets, and deletes an object', async () => {
    const storage = createS3Storage({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'areca',
      accessKey: process.env.S3_ACCESS_KEY ?? 'rustfsadmin',
      secretKey: process.env.S3_SECRET_KEY ?? 'rustfsadmin',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    })

    const key = `adapter-test/${Date.now()}.txt`
    const payload = Buffer.from('areca-s3-roundtrip', 'utf8')

    await storage.put(key, payload, 'text/plain')
    const got = await storage.get(key)
    expect(got).not.toBeNull()
    expect(Buffer.isBuffer(got?.body) ? got.body.equals(payload) : false).toBe(
      true,
    )
    expect(got?.contentType).toMatch(/text\/plain/)

    await storage.delete(key)
    expect(await storage.get(key)).toBeNull()
  })
})
