import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createS3Storage } from './s3'
import { StorageTimeoutError } from './timeouts'

// A stand-in for S3 that answers GET however the test scripts it: never
// answering, or sending headers and then stalling mid-body. No real S3 needed.
let mode: 'hang' | 'stall-body' = 'hang'
const sockets = new Set<Socket>()
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 200
    res.end()
    return
  }
  if (mode === 'hang') return
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': '1048576',
  })
  res.write(Buffer.alloc(1024, 1))
})
server.on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})

let endpoint = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function storageWith(getTimeoutMs: number) {
  return createS3Storage({
    endpoint,
    region: 'us-east-1',
    bucket: 'stalled',
    accessKey: 'test-access',
    secretKey: 'test-secret',
    forcePathStyle: true,
    getTimeoutMs,
  })
}

describe('s3 storage timeouts', () => {
  it('fails a GET that never answers, with a timeout error', async () => {
    mode = 'hang'
    const started = Date.now()
    const error = await storageWith(300)
      .get('asset.png')
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(StorageTimeoutError)
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 20_000)

  it('errors the body when the download stalls mid-read', async () => {
    mode = 'stall-body'
    const object = await storageWith(300).get('asset.png')
    expect(object).not.toBeNull()
    expect(object?.contentLength).toBe(1048576)
    const reader = object!.body.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    const error = await reader.read().then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(StorageTimeoutError)
  }, 20_000)
})
