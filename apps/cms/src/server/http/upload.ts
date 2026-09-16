export class UploadTooLargeError extends Error {
  constructor() {
    super('Upload too large')
    this.name = 'UploadTooLargeError'
  }
}

/**
 * Buffer a request up to a strict cap before invoking the platform multipart
 * parser. This keeps chunked uploads bounded as well as rejecting an oversized
 * Content-Length without reading the body.
 */
export async function parseLimitedFormData(
  request: Request,
  maxBodyBytes: number,
): Promise<FormData> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError('Invalid Content-Length')
    }
    if (length > maxBodyBytes) throw new UploadTooLargeError()
  }

  if (!request.body) return request.formData()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let done = false
  try {
    while (!done) {
      const result = await reader.read()
      done = result.done
      if (result.done) continue
      const { value } = result
      total += value.byteLength
      if (total > maxBodyBytes) {
        await reader.cancel()
        throw new UploadTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  }).formData()
}
