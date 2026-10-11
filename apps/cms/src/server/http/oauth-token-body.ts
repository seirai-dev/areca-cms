const MAX_OAUTH_TOKEN_BODY_BYTES = 65_536

export class OAuthTokenBodyTooLarge extends Error {}

/** Bound actual bytes as well as Content-Length; chunked bodies have no length. */
export async function readOAuthTokenBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > MAX_OAUTH_TOKEN_BODY_BYTES) throw new OAuthTokenBodyTooLarge()
  const reader = request.clone().body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      bytes += value.byteLength
      if (bytes > MAX_OAUTH_TOKEN_BODY_BYTES) {
        // Do not await cancellation of a tee: its other branch belongs to auth.
        void reader.cancel().catch(() => {})
        throw new OAuthTokenBodyTooLarge()
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}
