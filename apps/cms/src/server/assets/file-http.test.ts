import { S3Client } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createS3Storage } from '#/adapters/storage/s3'
import { createS3Namespace } from '#/adapters/storage/s3-namespace.mjs'
import { GET } from '#/routes/api/assets/file/$prefix/$filename'
import { storageKeyFromRequest, streamAssetFile } from './index'

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
  get: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
}))

// Keep the real GET -> decoder -> streaming path, isolating service and env
// dependencies so this suite never loads local env files or opens a database.
vi.mock('#/adapters', () => ({ getStorage: mocks.getStorage }))
vi.mock('#/db', () => ({ db: { select: mocks.select } }))
vi.mock('#/env', () => ({ env: {} }))
vi.mock('#/paraglide/messages', () => ({
  m: { server_not_found: () => 'Not found' },
}))
vi.mock('./storage-cleanup', () => ({
  beginObjectUpload: vi.fn(),
  completeObjectUpload: vi.fn(),
  compensateObjectUpload: vi.fn(),
  drainStorageObjectDeletions: vi.fn(),
}))
vi.mock('./image-validation', () => ({ validateImageBytes: vi.fn() }))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  mocks.getStorage.mockReturnValue({ get: mocks.get })
  mocks.get.mockImplementation((key: string) => {
    createS3Namespace('tenant/prod').objectKey(key)
    return null
  })
  mocks.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: mocks.limit }) }),
  })
  mocks.limit.mockResolvedValue([])
})

function request(key: string) {
  return new Request(`https://cms.test/api/assets/file/${key}`)
}

function get(key: string) {
  return GET({ request: request(key), params: {} })
}

describe('public asset file GET', () => {
  it.each([
    ['org%2F..%2Fasset.png', 'org/../asset.png'],
    ['..%2Fasset.png', '../asset.png'],
    ['org%2F.%2Fasset.png', 'org/./asset.png'],
    ['org%2F..%2F..%2Fasset.png', 'org/../../asset.png'],
    ['org/%00asset.png', 'org/\u0000asset.png'],
    ['a//b', 'a//b'],
    ['a%2F%2Fb', 'a//b'],
    ['%2Fasset.png', '/asset.png'],
    ['org/asset.png%2F', 'org/asset.png/'],
    ['org/%5Casset.png', 'org/\\asset.png'],
  ])('returns 404 for %s before storage or DB access', async (encoded, key) => {
    expect(storageKeyFromRequest(request(encoded))).toBe(key)
    const response = await get(encoded)
    expect(response.status).toBe(404)
    expect(mocks.getStorage).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it.each(['', '../asset', 'a//b', 'a\u0000b'])(
    'also guards direct streaming callers with key %j',
    async (key) => {
      expect((await streamAssetFile(key)).status).toBe(404)
      expect(mocks.getStorage).not.toHaveBeenCalled()
      expect(mocks.select).not.toHaveBeenCalled()
    },
  )

  it.each(['org/asset.png', 'org/my%20image.png', '%252e%252e/asset.png'])(
    'returns 404 for a valid missing key %s',
    async (encoded) => {
      expect((await get(encoded)).status).toBe(404)
      expect(mocks.getStorage).toHaveBeenCalledOnce()
      expect(mocks.get).toHaveBeenCalledWith(decodeURIComponent(encoded))
      expect(mocks.select).not.toHaveBeenCalled()
    },
  )

  it('streams an existing valid key and looks up its logical metadata', async () => {
    mocks.get.mockResolvedValue({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('image bytes'))
          controller.close()
        },
      }),
      contentType: 'image/png',
      contentLength: 11,
    })
    const response = await get('org/asset.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(await response.text()).toBe('image bytes')
    expect(mocks.get).toHaveBeenCalledWith('org/asset.png')
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  it('propagates real S3 adapter failures for valid keys', async () => {
    const error = Object.assign(new Error('Access denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    })
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValueOnce(error)
    mocks.getStorage.mockReturnValue(
      createS3Storage({
        endpoint: 'http://127.0.0.1:1',
        region: 'us-east-1',
        bucket: 'test-bucket',
        accessKey: 'fake-access',
        secretKey: 'fake-secret',
        forcePathStyle: true,
        prefix: 'tenant/prod',
      }),
    )
    await expect(get('org/asset.png')).rejects.toBe(error)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('propagates invalid storage configuration for valid keys', async () => {
    mocks.getStorage.mockImplementation(() => createS3Namespace('tenant//prod'))
    await expect(get('org/asset.png')).rejects.toThrow(/Invalid S3_PREFIX/)
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
