import { describe, expect, it } from 'vitest'

import { parseLimitedFormData, UploadTooLargeError } from './upload'

function multipartRequest(value: string) {
  const form = new FormData()
  form.set('value', value)
  return new Request('http://localhost/upload', { method: 'POST', body: form })
}

describe('parseLimitedFormData', () => {
  it('parses a multipart request within the cap', async () => {
    const form = await parseLimitedFormData(multipartRequest('ok'), 1024)
    expect(form.get('value')).toBe('ok')
  })

  it('rejects an oversized declared length before reading the body', async () => {
    const request = {
      headers: new Headers({ 'content-length': '11' }),
      body: {
        getReader() {
          throw new Error('body must not be read')
        },
      },
    } as unknown as Request

    await expect(parseLimitedFormData(request, 10)).rejects.toBeInstanceOf(
      UploadTooLargeError,
    )
  })

  it('cancels a chunked body as soon as it exceeds the cap', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
        controller.enqueue(new Uint8Array(6))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body,
      duplex: 'half',
    } as RequestInit)

    await expect(parseLimitedFormData(request, 10)).rejects.toBeInstanceOf(
      UploadTooLargeError,
    )
    expect(cancelled).toBe(true)
  })
})
