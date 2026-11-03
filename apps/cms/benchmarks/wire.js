import { toJSON, fromCrossJSON } from 'seroval'
export const encode = (data) => JSON.stringify(toJSON({ data }))
export function decode(text) {
  const parsed = JSON.parse(text)
  const result =
    parsed && typeof parsed === 'object' && 't' in parsed
      ? fromCrossJSON(parsed, {})
      : parsed
  if (result?.error) throw new Error('Server-function error')
  if (result?.redirect || result?.isNotFound)
    throw new Error('Unexpected navigation response')
  return result?.result ?? result
}
export function rpcRequest(base, manifest, name, data, cookie) {
  const fn = manifest[name]
  if (!fn) throw new Error(`Missing deployed function: ${name}`)
  const payload = encode(data)
  const url = `${base}/_serverFn/${fn.id}`
  return {
    method: fn.method,
    url:
      fn.method === 'GET'
        ? `${url}?payload=${encodeURIComponent(payload)}`
        : url,
    body: fn.method === 'POST' ? payload : null,
    headers: {
      'x-tsr-serverFn': 'true',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: base,
      Referer: `${base}/`,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookie,
    },
  }
}
