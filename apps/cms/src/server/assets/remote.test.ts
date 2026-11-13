import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withTestSite } from '#/server/content/test-utils'
import { AppError } from '#/server/http/app-error'

import { AssetValidationError, deleteAsset } from './index'
import {
  deriveFilename,
  fetchRemoteFile,
  httpStatusMessage,
  RemoteFetchError,
  sniffMimeType,
  UNSUPPORTED_FILE_MESSAGE,
  unsupportedDownloadMessage,
  uploadAssetFromUrl,
  WEB_PAGE_MESSAGE,
} from './remote'

// Test servers listen on 8080, one of the ports the fetcher allows.
const TEST_PORT = 8080

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
])

describe('URL validation (no network access)', () => {
  it.each([
    ['ftp://example.com/logo.png', 'Only http and https links are supported'],
    ['file:///etc/passwd', 'Only http and https links are supported'],
    ['https://user:secret@example.com/a.png', 'username or password'],
    ['https://example.com:22/a.png', 'Port 22 is not allowed'],
    ['https://example.com:3000/a.png', 'Port 3000 is not allowed'],
    ['http://127.0.0.1/a.png', 'private or local'],
    ['http://[::1]/a.png', 'private or local'],
    ['http://169.254.169.254/latest/meta-data', 'private or local'],
    ['http://10.0.0.5/a.png', 'private or local'],
    ['not a url', "isn't a valid web address"],
  ])('rejects %s', async (url, message) => {
    const error = await fetchRemoteFile(url).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(RemoteFetchError)
    expect(error).toBeInstanceOf(AppError)
    expect((error as Error).message).toContain(message)
  })
})

describe('deriveFilename', () => {
  it('uses the Content-Disposition filename when present', () => {
    expect(
      deriveFilename({
        url: 'https://example.com/download?id=1',
        contentDisposition: 'attachment; filename="Team Photo (final).PNG"',
        mimeType: 'image/png',
      }),
    ).toBe('Team-Photo-final-.PNG')
  })

  it('prefers the RFC 5987 filename* parameter', () => {
    expect(
      deriveFilename({
        url: 'https://example.com/x',
        contentDisposition: "attachment; filename*=UTF-8''report%202024.pdf",
        mimeType: 'application/pdf',
      }),
    ).toBe('report-2024.pdf')
  })

  it('falls back to the decoded last path segment', () => {
    expect(
      deriveFilename({
        url: 'https://example.com/media/my%20logo.png?v=3',
        mimeType: 'image/png',
      }),
    ).toBe('my-logo.png')
  })

  it('adds an extension matching the detected type when missing', () => {
    expect(
      deriveFilename({
        url: 'https://example.com/images/banner',
        mimeType: 'image/jpeg',
      }),
    ).toBe('banner.jpg')
    expect(
      deriveFilename({
        url: 'https://example.com/images/banner.jpeg',
        mimeType: 'image/jpeg',
      }),
    ).toBe('banner.jpeg')
    expect(
      deriveFilename({
        url: 'https://example.com/a/data.txt',
        mimeType: 'application/pdf',
      }),
    ).toBe('data.txt.pdf')
  })

  it('falls back to download when nothing usable is present', () => {
    expect(deriveFilename({ url: 'https://example.com/' })).toBe('download')
    expect(
      deriveFilename({ url: 'https://example.com/', mimeType: 'image/webp' }),
    ).toBe('download.webp')
    expect(
      deriveFilename({
        url: 'https://example.com/%2E%2E%2F',
        contentDisposition: 'attachment; filename="../../"',
      }),
    ).toBe('download')
  })

  it('strips path traversal and caps the length', () => {
    const name = deriveFilename({
      url: 'https://example.com/x',
      contentDisposition: `attachment; filename="../../etc/${'a'.repeat(300)}.png"`,
      mimeType: 'image/png',
    })
    expect(name).not.toContain('/')
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.png')).toBe(true)
  })
})

describe('sniffMimeType', () => {
  it('detects supported types from magic bytes', () => {
    expect(sniffMimeType(PNG_BYTES)).toBe('image/png')
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    )
    expect(sniffMimeType(Buffer.from('GIF89a....', 'latin1'))).toBe('image/gif')
    expect(sniffMimeType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe(
      'image/webp',
    )
    expect(sniffMimeType(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe(
      'application/pdf',
    )
  })

  it('returns null for SVG and HTML', () => {
    expect(
      sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull()
    expect(
      sniffMimeType(Buffer.from('<!doctype html><html></html>')),
    ).toBeNull()
  })
})

describe('fetchRemoteFile against a local server', () => {
  let server: http.Server
  let origin: string
  let hits: string[] = []
  const sockets = new Set<Socket>()

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '')
      const path = req.url ?? ''
      if (path === '/files/logo.png') {
        res.writeHead(200, { 'content-type': 'image/png; charset=binary' })
        res.end(PNG_BYTES)
        return
      }
      if (path === '/files/doc') {
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="Quarterly.pdf"',
        })
        res.end('%PDF-1.4 test')
        return
      }
      if (path === '/r1') return redirect(res, '/r2')
      if (path === '/r2') return redirect(res, '/r3')
      if (path === '/r3') return redirect(res, '/files/logo.png')
      if (path === '/loop') return redirect(res, '/loop')
      if (path === '/r4') return redirect(res, '/r5')
      if (path === '/r5') return redirect(res, '/r6')
      if (path === '/r6') return redirect(res, '/r7')
      if (path === '/r7') return redirect(res, '/files/logo.png')
      if (path === '/oversize-length') {
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': '2000',
        })
        res.end(Buffer.alloc(2000))
        return
      }
      if (path === '/oversize-stream') {
        res.writeHead(200, { 'content-type': 'image/png' })
        for (let i = 0; i < 5; i++) res.write(Buffer.alloc(400))
        res.end()
        return
      }
      if (path === '/hang') {
        // Never respond.
        return
      }
      if (path === '/server-error') {
        res.writeHead(503, { 'content-type': 'text/plain' })
        res.end('busy')
        return
      }
      if (path === '/article') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          '<!DOCTYPE html><html><body>Photo page, not the photo</body></html>',
        )
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('nope')
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(TEST_PORT, '127.0.0.1', () => resolve())
    })
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function redirect(res: http.ServerResponse, location: string) {
    res.writeHead(302, { location })
    res.end()
  }

  it('downloads a file and reports its media type and name', async () => {
    const file = await fetchRemoteFile(`${origin}/files/logo.png`, {
      allowPrivateNetwork: true,
    })
    expect(file.bytes.equals(PNG_BYTES)).toBe(true)
    expect(file.contentType).toBe('image/png')
    expect(file.filename).toBe('logo.png')
    expect(file.finalUrl).toBe(`${origin}/files/logo.png`)
  })

  it('uses the Content-Disposition filename', async () => {
    const file = await fetchRemoteFile(`${origin}/files/doc`, {
      allowPrivateNetwork: true,
    })
    expect(file.contentType).toBe('application/pdf')
    expect(file.filename).toBe('Quarterly.pdf')
  })

  it('follows a redirect chain within the limit and reports the final URL', async () => {
    const file = await fetchRemoteFile(`${origin}/r1`, {
      allowPrivateNetwork: true,
    })
    expect(file.finalUrl).toBe(`${origin}/files/logo.png`)
    expect(file.bytes.equals(PNG_BYTES)).toBe(true)
  })

  it('stops when the redirect limit is exceeded', async () => {
    const error = await fetchRemoteFile(`${origin}/r4`, {
      allowPrivateNetwork: true,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(RemoteFetchError)
    expect((error as Error).message).toBe('The link redirected too many times')
  })

  it('stops a redirect loop', async () => {
    await expect(
      fetchRemoteFile(`${origin}/loop`, {
        allowPrivateNetwork: true,
        maxRedirects: 2,
      }),
    ).rejects.toThrow('The link redirected too many times')
  })

  it('explains a 4xx answer with the host, the status and what to check', async () => {
    const error = await fetchRemoteFile(`${origin}/missing`, {
      allowPrivateNetwork: true,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(RemoteFetchError)
    expect((error as Error).message).toBe(
      "The link didn't return a downloadable file (HTTP 404 from 127.0.0.1). Check the URL points directly to an image or PDF file.",
    )
  })

  it('tells the agent to retry or change link on a 5xx answer', async () => {
    await expect(
      fetchRemoteFile(`${origin}/server-error`, { allowPrivateNetwork: true }),
    ).rejects.toThrow(
      'The server at 127.0.0.1 failed (HTTP 503). It may be temporarily down: try again later, or use a different link.',
    )
  })

  it('reports a web page link as a web page, not a file', async () => {
    const error = await uploadAssetFromUrl(
      { organizationId: 'org', url: `${origin}/article`, actorId: 'user' },
      { fetch: (url) => fetchRemoteFile(url, { allowPrivateNetwork: true }) },
    ).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(AssetValidationError)
    expect((error as Error).message).toBe(WEB_PAGE_MESSAGE)
  })

  it('rejects a declared Content-Length above the limit before reading the body', async () => {
    await expect(
      fetchRemoteFile(`${origin}/oversize-length`, {
        allowPrivateNetwork: true,
        maxBytes: 1000,
      }),
    ).rejects.toThrow('The file is larger than 1 KB')
  })

  it('aborts a streamed body without Content-Length once it exceeds the limit', async () => {
    const error = await fetchRemoteFile(`${origin}/oversize-stream`, {
      allowPrivateNetwork: true,
      maxBytes: 1000,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(RemoteFetchError)
    expect((error as Error).message).toMatch(/^The file is larger than/)
  })

  it('times out when the server never responds', async () => {
    const started = Date.now()
    await expect(
      fetchRemoteFile(`${origin}/hang`, {
        allowPrivateNetwork: true,
        timeoutMs: 300,
      }),
    ).rejects.toThrow('The download timed out')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('refuses localhost without allowPrivateNetwork and never connects', async () => {
    hits = []
    const port = (server.address() as AddressInfo).port
    await expect(
      fetchRemoteFile(`http://localhost:${port}/files/logo.png`),
    ).rejects.toThrow(
      "That address is private or local and can't be downloaded",
    )
    expect(hits).toHaveLength(0)
  })

  it('refuses a literal loopback address without allowPrivateNetwork', async () => {
    hits = []
    await expect(fetchRemoteFile(`${origin}/files/logo.png`)).rejects.toThrow(
      "That address is private or local and can't be downloaded",
    )
    expect(hits).toHaveLength(0)
  })
})

describe('httpStatusMessage', () => {
  it('names the host and status for client errors', () => {
    expect(httpStatusMessage(404, 'upload.wikimedia.org')).toBe(
      "The link didn't return a downloadable file (HTTP 404 from upload.wikimedia.org). Check the URL points directly to an image or PDF file.",
    )
    expect(httpStatusMessage(403, 'example.com')).toContain(
      'HTTP 403 from example.com',
    )
  })

  it('says the server failed for 5xx answers', () => {
    expect(httpStatusMessage(502, 'example.com')).toBe(
      'The server at example.com failed (HTTP 502). It may be temporarily down: try again later, or use a different link.',
    )
  })
})

describe('unsupportedDownloadMessage', () => {
  const html = Buffer.from('<!doctype html><html><body>hi</body></html>')

  it('calls an HTML page a web page and asks for a direct image URL', () => {
    expect(
      unsupportedDownloadMessage({ bytes: html, contentType: 'text/html' }),
    ).toBe(
      'The link returned a web page (text/html), not an image. Use a direct image URL.',
    )
  })

  it('recognises HTML bytes even when the declared type is an image', () => {
    expect(
      unsupportedDownloadMessage({ bytes: html, contentType: 'image/png' }),
    ).toBe(WEB_PAGE_MESSAGE)
  })

  it('names other non-file types the link returned', () => {
    expect(
      unsupportedDownloadMessage({
        bytes: Buffer.from('{"a":1}'),
        contentType: 'application/json',
      }),
    ).toBe(
      'The link returned a file of type application/json, not an image or PDF. Use a direct image URL.',
    )
  })

  it('keeps the format list for SVG and unknown types', () => {
    expect(
      unsupportedDownloadMessage({
        bytes: Buffer.from('<svg/>'),
        contentType: 'image/svg+xml',
      }),
    ).toBe(UNSUPPORTED_FILE_MESSAGE)
    expect(
      unsupportedDownloadMessage({
        bytes: Buffer.from('xx'),
        contentType: null,
      }),
    ).toBe(UNSUPPORTED_FILE_MESSAGE)
  })
})

describe('uploadAssetFromUrl without a database', () => {
  it('reports a web page without storing anything', async () => {
    await expect(
      uploadAssetFromUrl(
        {
          organizationId: 'org',
          url: 'https://example.com/photo',
          actorId: 'user',
        },
        {
          fetch: async (url) => ({
            bytes: Buffer.from('<html><body>gallery</body></html>'),
            contentType: 'text/html',
            filename: 'photo',
            finalUrl: url,
          }),
        },
      ),
    ).rejects.toThrow(WEB_PAGE_MESSAGE)
  })

  it('rejects an SVG payload before storage or database access', async () => {
    await expect(
      uploadAssetFromUrl(
        {
          organizationId: 'org',
          url: 'https://example.com/logo.svg',
          actorId: 'user',
        },
        {
          fetch: async (url) => ({
            bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
            contentType: 'image/svg+xml',
            filename: 'logo.svg',
            finalUrl: url,
          }),
        },
      ),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })

  it('does not trust a PNG Content-Type for non-image bytes', async () => {
    await expect(
      uploadAssetFromUrl(
        {
          organizationId: 'org',
          url: 'https://example.com/a.png',
          actorId: 'user',
        },
        {
          fetch: async (url) => ({
            bytes: Buffer.from('<html>not an image</html>'),
            contentType: 'image/png',
            filename: 'a.png',
            finalUrl: url,
          }),
        },
      ),
    ).rejects.toBeInstanceOf(AssetValidationError)
  })
})

describe.skipIf(!process.env.DATABASE_URL || !process.env.S3_ENDPOINT)(
  'uploadAssetFromUrl',
  () => {
    it('stores a PNG fetched from a URL as a library asset', () =>
      withTestSite(async ({ org, actor }) => {
        const buffer = await sharp({
          create: {
            width: 12,
            height: 8,
            channels: 3,
            background: { r: 0, g: 128, b: 255 },
          },
        })
          .png()
          .toBuffer()

        const uploaded = await uploadAssetFromUrl(
          {
            organizationId: org.id,
            url: 'https://cdn.example.com/images/remote-blue.png',
            altText: 'A blue rectangle',
            actorId: actor.id,
          },
          {
            fetch: async (url) => ({
              bytes: buffer,
              contentType: 'image/png',
              filename: 'remote-blue.png',
              finalUrl: url,
            }),
          },
        )

        try {
          expect(uploaded.mimeType).toBe('image/png')
          expect(uploaded.size).toBe(buffer.byteLength)
          expect(uploaded.width).toBe(12)
          expect(uploaded.height).toBe(8)
          expect(uploaded.originalFilename).toBe('remote-blue.png')
          expect(uploaded.altText).toBe('A blue rectangle')
          expect(uploaded.storageKey).toMatch(
            new RegExp(`^${org.id}/[0-9a-f-]{36}\\.png$`),
          )
        } finally {
          await deleteAsset(uploaded.id, org.id)
        }
      }))
  },
)
