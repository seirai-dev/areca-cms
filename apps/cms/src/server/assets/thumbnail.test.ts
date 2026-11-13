import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '#/routes/api/assets/file/$prefix/$filename'
import { createLimiter, derivedStorageKeys, thumbnailKey } from './derived'
import { assetPreview } from './preview'

const mocks = vi.hoisted(() => ({
  objects: new Map<string, { bytes: Buffer; contentType: string }>(),
  rows: new Map<string, { mimeType: string; width: number | null }>(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('#/adapters', () => ({
  getStorage: () => ({
    get: mocks.get,
    put: mocks.put,
    delete: mocks.delete,
  }),
}))
// Every test has one asset row; both the thumbnail and the original file
// lookups select it by storage key.
vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [...mocks.rows.values()].slice(0, 1),
        }),
      }),
    }),
  },
}))
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

function body(bytes: Buffer) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
}

let photo: Buffer
beforeAll(async () => {
  photo = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: '#3366cc' },
  })
    .jpeg()
    .toBuffer()
})

beforeEach(() => {
  mocks.objects.clear()
  mocks.rows.clear()
  mocks.get.mockReset()
  mocks.put.mockReset()
  mocks.delete.mockReset()
  mocks.delete.mockImplementation(async (key: string) => {
    mocks.objects.delete(key)
  })
  mocks.get.mockImplementation(async (key: string) => {
    const object = mocks.objects.get(key)
    return object
      ? {
          body: body(object.bytes),
          contentType: object.contentType,
          contentLength: object.bytes.byteLength,
        }
      : null
  })
  mocks.put.mockImplementation(
    async (key: string, bytes: Buffer, contentType: string) => {
      mocks.objects.set(key, { bytes: Buffer.from(bytes), contentType })
    },
  )
})

function addAsset(
  key: string,
  bytes: Buffer,
  mimeType: string,
  width: number | null,
) {
  mocks.objects.set(key, { bytes, contentType: mimeType })
  mocks.rows.set(key, { mimeType, width })
}

/** What deleteAsset and its cleanup do: the row and every object go. */
function deleteAssetNow(key: string) {
  mocks.rows.delete(key)
  for (const stored of [key, ...derivedStorageKeys(key)])
    mocks.objects.delete(stored)
}

function get(path: string, accept = 'image/avif,image/webp,*/*') {
  return GET({
    request: new Request(`https://cms.test/api/assets/file/${path}`, {
      headers: { accept },
    }),
    params: {},
  })
}

describe('asset thumbnails (?w=)', () => {
  it.each(['100', '321', '320.0', 'abc', '', '99999'])(
    'refuses width %j before touching storage',
    async (width) => {
      const response = await get(`org/photo.jpg?w=${width}`)
      expect(response.status).toBe(400)
      expect(mocks.get).not.toHaveBeenCalled()
    },
  )

  it('keeps the file route key guards', async () => {
    const response = await get('org%2F..%2Fphoto.jpg?w=320')
    expect(response.status).toBe(404)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('renders a narrower WebP once, stores it next to the original and serves it with immutable caching', async () => {
    addAsset('org/photo.jpg', photo, 'image/jpeg', 2000)
    const first = await get('org/photo.jpg?w=320', 'image/webp,*/*')
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('image/webp')
    expect(first.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(first.headers.get('Vary')).toBe('Accept')
    expect(first.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const bytes = Buffer.from(await first.arrayBuffer())
    const meta = await sharp(bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(320)
    expect(mocks.put).toHaveBeenCalledOnce()
    expect(mocks.put).toHaveBeenCalledWith(
      thumbnailKey('org/photo.jpg', 320, 'webp'),
      expect.anything(),
      'image/webp',
    )

    mocks.get.mockClear()
    const second = await get('org/photo.jpg?w=320', 'image/webp,*/*')
    expect(Buffer.from(await second.arrayBuffer())).toEqual(bytes)
    expect(mocks.put).toHaveBeenCalledOnce()
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.get).toHaveBeenCalledWith(
      thumbnailKey('org/photo.jpg', 320, 'webp'),
    )
  })

  it('prefers AVIF when the client accepts it', async () => {
    addAsset('org/photo.jpg', photo, 'image/jpeg', 2000)
    const response = await get('org/photo.jpg?w=640')
    expect(response.headers.get('Content-Type')).toBe('image/avif')
    const meta = await sharp(
      Buffer.from(await response.arrayBuffer()),
    ).metadata()
    expect(meta.width).toBe(640)
  })

  it.each([
    ['a PDF', 'org/file.pdf', 'application/pdf', null, 'image/webp'],
    ['a GIF', 'org/anim.gif', 'image/gif', 2000, 'image/webp'],
    [
      'an image already that narrow',
      'org/small.jpg',
      'image/jpeg',
      300,
      'image/webp',
    ],
    [
      'a client without AVIF or WebP',
      'org/photo.jpg',
      'image/jpeg',
      2000,
      'image/png,*/*',
    ],
  ])(
    'serves the original for %s, never enlarged or converted',
    async (_, key, mimeType, width, accept) => {
      addAsset(key, photo, mimeType, width)
      const response = await get(`${key}?w=320`, accept)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe(mimeType)
      expect(response.headers.get('Vary')).toBe('Accept')
      expect(Buffer.from(await response.arrayBuffer())).toEqual(photo)
      expect(mocks.put).not.toHaveBeenCalled()
    },
  )

  it('returns 404 for a missing original', async () => {
    mocks.rows.set('org/gone.jpg', { mimeType: 'image/jpeg', width: 2000 })
    expect((await get('org/gone.jpg?w=320')).status).toBe(404)
  })

  it('removes a thumbnail whose asset was deleted while it rendered', async () => {
    addAsset('org/photo.jpg', photo, 'image/jpeg', 2000)
    const key = thumbnailKey('org/photo.jpg', 1280, 'avif')
    mocks.put.mockImplementationOnce(
      async (putKey: string, bytes: Buffer, contentType: string) => {
        deleteAssetNow('org/photo.jpg')
        mocks.objects.set(putKey, { bytes: Buffer.from(bytes), contentType })
      },
    )
    expect((await get('org/photo.jpg?w=1280')).status).toBe(404)
    expect(mocks.delete).toHaveBeenCalledWith(key)
    expect(mocks.objects.has(key)).toBe(false)
  })

  it('never serves a stored thumbnail of a deleted asset', async () => {
    const key = thumbnailKey('org/photo.jpg', 320, 'webp')
    mocks.objects.set(key, { bytes: photo, contentType: 'image/webp' })
    const response = await get('org/photo.jpg?w=320', 'image/webp,*/*')
    expect(response.status).toBe(404)
    expect(mocks.get).not.toHaveBeenCalledWith(key)
  })

  it('lists every derived key for deletion', () => {
    expect(derivedStorageKeys('org/photo.jpg')).toContain(
      thumbnailKey('org/photo.jpg', 1280, 'avif'),
    )
    expect(derivedStorageKeys('org/photo.jpg')).toContain(
      'derived/org/photo.jpg/preview.jpg',
    )
  })
})

describe('MCP image previews', () => {
  it('renders a preview once and reads the stored copy afterwards', async () => {
    addAsset('org/photo.jpg', photo, 'image/jpeg', 2000)
    const row = {
      id: 'a',
      storageKey: 'org/photo.jpg',
      mimeType: 'image/jpeg',
    }
    const first = await assetPreview(row)
    const second = await assetPreview(row)
    expect(first?.mimeType).toBe('image/jpeg')
    expect(second).toEqual(first)
    expect(mocks.put).toHaveBeenCalledOnce()
  })

  it('removes a preview whose asset was deleted while it rendered', async () => {
    addAsset('org/photo.jpg', photo, 'image/jpeg', 2000)
    mocks.put.mockImplementationOnce(
      async (putKey: string, bytes: Buffer, contentType: string) => {
        deleteAssetNow('org/photo.jpg')
        mocks.objects.set(putKey, { bytes: Buffer.from(bytes), contentType })
      },
    )
    expect(
      await assetPreview({
        id: 'a',
        storageKey: 'org/photo.jpg',
        mimeType: 'image/jpeg',
      }),
    ).toBeNull()
    expect(mocks.objects.has('derived/org/photo.jpg/preview.jpg')).toBe(false)
  })

  it('has no preview for a PDF', async () => {
    expect(
      await assetPreview({
        id: 'p',
        storageKey: 'org/f.pdf',
        mimeType: 'application/pdf',
      }),
    ).toBeNull()
  })
})

describe('render limiter', () => {
  it('runs at most the given number of tasks at once', async () => {
    const run = createLimiter(3)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 20 }, () =>
        run(async () => {
          active++
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 2))
          active--
        }),
      ),
    )
    expect(peak).toBe(3)
  })
})
