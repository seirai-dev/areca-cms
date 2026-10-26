import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createS3Storage } from './s3'

// Exercise the actual AWS serialization against a loopback-only S3 stand-in.
const requests: Array<{ method: string; key: string }> = []
const objects = new Map<string, Buffer>()
const server = http.createServer(async (req, res) => {
  const key = decodeURIComponent(
    new URL(req.url!, 'http://localhost').pathname,
  ).slice('/test-bucket/'.length)
  requests.push({ method: req.method!, key })
  if (req.method === 'PUT') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    objects.set(key, Buffer.concat(chunks))
  } else if (req.method === 'DELETE') {
    objects.delete(key)
  } else if (!objects.has(key)) {
    res.writeHead(404)
    res.end()
    return
  } else {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(objects.get(key))
    return
  }
  res.writeHead(200)
  res.end()
})
let endpoint: string
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
beforeEach(() => {
  objects.clear()
  requests.length = 0
})
function storage(prefix?: string) {
  return createS3Storage({
    endpoint,
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKey: 'fake-access',
    secretKey: 'fake-secret',
    forcePathStyle: true,
    ...{ prefix },
  })
}

describe('S3 prefix boundary', () => {
  describe.each([undefined, '', 'tenant/prod'])(
    'unsafe keys with prefix %j',
    (prefix) => {
      it.each([
        '../escape',
        'a/../../escape',
        './asset',
        'a/./asset',
        '/asset',
        'a//asset',
        'a\\..\\escape',
        'a\u0000b',
        '',
      ])('rejects unsafe logical key %j before any request', async (key) => {
        const adapter = storage(prefix)
        await expect(
          adapter.put(key, Buffer.from('bytes'), 'image/png'),
        ).rejects.toThrow(/key/i)
        await expect(adapter.get(key)).rejects.toThrow(/key/i)
        await expect(adapter.delete(key)).rejects.toThrow(/key/i)
        expect(requests).toEqual([])
      })
    },
  )

  it('keeps literal percent-encoded segments and filenames inside the prefix', async () => {
    const adapter = storage('tenant/prod')
    for (const key of ['%2e%2e/asset', 'org/my image.png', 'org/café.png']) {
      await adapter.put(key, Buffer.from('bytes'), 'image/png')
      await adapter.get(key)
      await adapter.delete(key)
    }
    expect(
      requests.every((request) => request.key.startsWith('tenant/prod/')),
    ).toBe(true)
    expect(requests[0].key).toBe('tenant/prod/%2e%2e/asset')
  })
  it.each([undefined, ''])(
    'keeps bucket-root behavior for %j',
    async (prefix) => {
      const adapter = storage(prefix)
      await adapter.put('org/asset', Buffer.from('bytes'), 'image/png')
      const got = await adapter.get('org/asset')
      expect(await new Response(got!.body).text()).toBe('bytes')
      await adapter.delete('org/asset')
      expect(requests).toEqual([
        { method: 'PUT', key: 'org/asset' },
        { method: 'GET', key: 'org/asset' },
        { method: 'DELETE', key: 'org/asset' },
      ])
    },
  )

  it.each(['tenant/prod', '/tenant/prod/', '///tenant/prod///'])(
    'normalizes %j and applies it once to assets, branding and cleanup deletes',
    async (prefix) => {
      const adapter = storage(prefix)
      // A logical key can happen to start with the namespace: do not infer that
      // it is already physical and silently skip applying the boundary.
      for (const key of [
        'org/asset',
        'branding/logo.png',
        'tenant/prod/asset',
      ]) {
        objects.set(key, Buffer.from('root object must survive'))
        await adapter.put(key, Buffer.from('scoped bytes'), 'image/png')
        const got = await adapter.get(key)
        expect(await new Response(got!.body).text()).toBe('scoped bytes')
        await adapter.delete(key)
        expect(objects.get(key)?.toString()).toBe('root object must survive')
        expect(objects.has(`tenant/prod/${key}`)).toBe(false)
      }
      expect(requests).toEqual(
        ['org/asset', 'branding/logo.png', 'tenant/prod/asset'].flatMap((key) =>
          ['PUT', 'GET', 'DELETE'].map((method) => ({
            method,
            key: `tenant/prod/${key}`,
          })),
        ),
      )
    },
  )

  it('returns a scoped miss without reading an existing root object', async () => {
    objects.set('org/asset', Buffer.from('old deployment'))
    expect(await storage('tenant/prod').get('org/asset')).toBeNull()
    expect(requests).toEqual([{ method: 'GET', key: 'tenant/prod/org/asset' }])
  })

  it.each([
    '/',
    '///',
    ' ',
    ' tenant',
    'tenant ',
    'tenant/a b',
    'tenant\tpart',
    'tenant\npart',
    'tenant\rpart',
    'tenant\u0000part',
    'tenant\u001fpart',
    'tenant\u007fpart',
    'tenant\u00a0part',
    'tenant\\part',
    'tenant//part',
    '.',
    '..',
    'tenant/./part',
    'tenant/../part',
    '/tenant//part/',
  ])(
    'rejects invalid nonempty prefix %j before sending any request',
    (prefix) => {
      expect(() => storage(prefix)).toThrow(/prefix/i)
      expect(requests).toEqual([])
    },
  )
})
