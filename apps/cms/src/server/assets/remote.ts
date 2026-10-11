import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ClientRequest, RequestOptions } from 'node:http'
import { isIP } from 'node:net'

import { AppError } from '#/server/http/app-error'

import { AssetValidationError, MAX_SIZE_BYTES, uploadAsset } from './index'
import type { Asset } from './index'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 3
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443])
const USER_AGENT = 'ArecaCMS/1.0 (+asset-import)'
const ACCEPT = 'image/*,application/pdf'
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export const PRIVATE_ADDRESS_MESSAGE =
  "That address is private or local and can't be downloaded"
export const UNSUPPORTED_SCHEME_MESSAGE = 'Only http and https links are supported'
export const TIMEOUT_MESSAGE = 'The download timed out'
export const REDIRECT_LIMIT_MESSAGE = 'The link redirected too many times'
export const UNSUPPORTED_FILE_MESSAGE =
  'Unsupported file type. Use a JPEG, PNG, WebP, GIF or PDF file.'
export const WEB_PAGE_MESSAGE =
  'The link returned a web page (text/html), not an image. Use a direct image URL.'

/** Message for a non-2xx answer. Names the host and status so the agent can tell the user what happened. */
export function httpStatusMessage(status: number, host: string): string {
  if (status >= 400 && status < 500) {
    return `The link didn't return a downloadable file (HTTP ${status} from ${host}). Check the URL points directly to an image or PDF file.`
  }
  if (status >= 500) {
    return `The server at ${host} failed (HTTP ${status}). It may be temporarily down: try again later, or use a different link.`
  }
  return `The link didn't return a downloadable file (HTTP ${status} from ${host}). Check the URL points directly to an image or PDF file.`
}

export class RemoteFetchError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteFetchError'
  }
}

export type RemoteFile = {
  bytes: Buffer
  /** Media type from the Content-Type header (parameters stripped), or null. */
  contentType: string | null
  filename: string
  finalUrl: string
}

export type FetchRemoteFileOptions = {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  allowPrivateNetwork?: boolean
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  )
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null
}

function isPublicIPv4(octets: number[]): boolean {
  const [a, b, c] = octets as [number, number, number]
  if (a === 0 || a === 10 || a === 127) return false // 0/8, 10/8, 127/8
  if (a === 100 && b >= 64 && b <= 127) return false // 100.64/10
  if (a === 169 && b === 254) return false // 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return false // 172.16/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // 192.0.0/24, 192.0.2/24
  if (a === 192 && b === 168) return false // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return false // 198.18/15
  if (a === 198 && b === 51 && c === 100) return false // 198.51.100/24
  if (a === 203 && b === 0 && c === 113) return false // 203.0.113/24
  if (a >= 224) return false // multicast 224/4 and reserved 240/4 (incl. broadcast)
  return true
}

function parseHextet(part: string): number {
  return /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN
}

/** Expands an IPv6 literal into eight 16-bit groups. Returns null when malformed. */
function parseIPv6(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)

  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail)
    if (!v4) return null
    const high = (v4[0] << 8) | v4[1]
    const low = (v4[2] << 8) | v4[3]
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const rest = halves[1] ? halves[1].split(':') : []
    const missing = 8 - head.length - rest.length
    if (missing < 1) return null
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const numbers = groups.map(parseHextet)
  return numbers.some((n) => Number.isNaN(n)) ? null : numbers
}

function isPublicIPv6(groups: number[]): boolean {
  const g = (index: number) => groups[index]
  const firstFiveZero = [0, 1, 2, 3, 4].every((i) => g(i) === 0)

  // IPv4-mapped ::ffff:a.b.c.d
  if (firstFiveZero && g(5) === 0xffff) {
    return isPublicIPv4([g(6) >> 8, g(6) & 0xff, g(7) >> 8, g(7) & 0xff])
  }
  // IPv4-compatible ::a.b.c.d (deprecated) and the unspecified / loopback addresses
  if (groups.slice(0, 6).every((n) => n === 0)) return false
  // NAT64 well-known prefix 64:ff9b::/96 carries an IPv4 address in the low 32 bits
  if (g(0) === 0x64 && g(1) === 0xff9b && [2, 3, 4, 5].every((i) => g(i) === 0)) {
    return isPublicIPv4([g(6) >> 8, g(6) & 0xff, g(7) >> 8, g(7) & 0xff])
  }
  // 6to4 2002::/16 embeds an IPv4 address in the next 32 bits
  if (g(0) === 0x2002) {
    return isPublicIPv4([g(1) >> 8, g(1) & 0xff, g(2) >> 8, g(2) & 0xff])
  }
  // Only 2000::/3 is globally routable unicast; everything else is refused.
  if ((g(0) & 0xe000) !== 0x2000) return false
  // Documentation 2001:db8::/32
  if (g(0) === 0x2001 && g(1) === 0x0db8) return false
  // Teredo 2001:0::/32 (obfuscated embedded addresses; refused outright)
  if (g(0) === 0x2001 && g(1) === 0x0000) return false
  return true
}

/**
 * True only for addresses on the public internet. Literal non-IP strings return
 * false. IPv4-mapped, NAT64 and 6to4 addresses are judged by their embedded IPv4.
 */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const octets = parseIPv4(ip)
    return octets ? isPublicIPv4(octets) : false
  }
  if (version === 6) {
    const groups = parseIPv6(ip)
    return groups ? isPublicIPv6(groups) : false
  }
  return false
}

// ---------------------------------------------------------------------------
// Media type and filename helpers
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Detects the media type from the file's leading bytes. Null when not a supported type. */
export function sniffMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  const head = bytes.subarray(0, 6).toString('latin1')
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf'
  }
  return null
}

const EXTENSIONS_BY_MIME: Record<string, { preferred: string; accepted: string[] }> = {
  'image/jpeg': { preferred: 'jpg', accepted: ['jpg', 'jpeg'] },
  'image/png': { preferred: 'png', accepted: ['png'] },
  'image/webp': { preferred: 'webp', accepted: ['webp'] },
  'image/gif': { preferred: 'gif', accepted: ['gif'] },
  'application/pdf': { preferred: 'pdf', accepted: ['pdf'] },
}

const MAX_FILENAME_LENGTH = 120

function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+$/, '')
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext
}

/** Adds the extension for the detected media type when the name lacks an equivalent one. */
function withMimeExtension(name: string, mimeType: string | null): string {
  const info = mimeType ? EXTENSIONS_BY_MIME[mimeType] : undefined
  if (!info) return name
  const dot = name.lastIndexOf('.')
  const current = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (current && info.accepted.includes(current)) return name
  return `${name}.${info.preferred}`
}

function cleanFilename(raw: string | null | undefined, mimeType: string | null): string | undefined {
  const cleaned = raw ? sanitizeFilename(raw) : ''
  return cleaned ? withMimeExtension(cleaned, mimeType) : undefined
}

function filenameFromContentDisposition(value: string): string | undefined {
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(value)
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall through to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(value)
  const found = plain?.[1] ?? plain?.[2]
  return found?.trim() || undefined
}

function filenameFromUrlPath(url: string): string | undefined {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  if (!last) return undefined
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * Chooses a safe filename: Content-Disposition first, then the last URL path
 * segment, then "download". The extension is made to match the detected media type.
 */
export function deriveFilename(input: {
  url: string
  contentDisposition?: string | null
  mimeType?: string | null
}): string {
  const mimeType = input.mimeType ?? null
  const fromHeader = input.contentDisposition
    ? cleanFilename(filenameFromContentDisposition(input.contentDisposition), mimeType)
    : undefined
  return (
    fromHeader ??
    cleanFilename(filenameFromUrlPath(input.url), mimeType) ??
    withMimeExtension('download', mimeType)
  )
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function parseRemoteUrl(raw: string, allowPrivateNetwork: boolean): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RemoteFetchError("That isn't a valid web address")
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RemoteFetchError(UNSUPPORTED_SCHEME_MESSAGE)
  }
  if (url.username || url.password) {
    throw new RemoteFetchError('Links with a username or password are not supported')
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80
  if (!ALLOWED_PORTS.has(port)) {
    throw new RemoteFetchError(
      `Port ${port} is not allowed. Use 80, 443, 8080 or 8443`,
    )
  }
  const host = unbracket(url.hostname)
  if (!host) throw new RemoteFetchError("That isn't a valid web address")
  if (isIP(host) && !allowPrivateNetwork && !isPublicAddress(host)) {
    throw new RemoteFetchError(PRIVATE_ADDRESS_MESSAGE)
  }
  return url
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type LookupCallback = (
  error: Error | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void

/**
 * DNS lookup used by the socket at connect time. Every resolved address must be
 * public, so a rebinding answer cannot slip a private address past the check.
 */
function createSafeLookup(allowPrivateNetwork: boolean) {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: LookupCallback,
  ) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, records) => {
      if (error) {
        callback(new RemoteFetchError(dnsFailureMessage(error)))
        return
      }
      if (records.length === 0) {
        callback(new RemoteFetchError('The domain name could not be resolved'))
        return
      }
      if (!allowPrivateNetwork && records.some((r) => !isPublicAddress(r.address))) {
        callback(new RemoteFetchError(PRIVATE_ADDRESS_MESSAGE))
        return
      }
      const family = options.family === 4 || options.family === 6 ? options.family : undefined
      const pool = family ? records.filter((r) => r.family === family) : records
      if (options.all) {
        callback(null, pool)
        return
      }
      const chosen = pool.at(0)
      if (!chosen) {
        callback(new RemoteFetchError('The domain name could not be resolved'))
        return
      }
      callback(null, chosen.address, chosen.family)
    })
  }
}

function dnsFailureMessage(error: NodeJS.ErrnoException): string {
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' || error.code === 'ENODATA') {
    return 'The domain name could not be resolved'
  }
  return 'Could not reach the server'
}

/** Mutable state shared by the hops of one download, so the timeout can stop whichever step is running. */
type Transfer = {
  failure?: RemoteFetchError
  active?: ClientRequest | IncomingMessage
}

function abortTransfer(transfer: Transfer, error: RemoteFetchError) {
  transfer.failure ??= error
  transfer.active?.destroy(transfer.failure)
}

function sendRequest(
  url: URL,
  allowPrivateNetwork: boolean,
  transfer: Transfer,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (transfer.failure) {
      reject(transfer.failure)
      return
    }
    const transport = url.protocol === 'https:' ? https : http
    const options: RequestOptions = {
      method: 'GET',
      agent: false,
      headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
      lookup: createSafeLookup(allowPrivateNetwork) as RequestOptions['lookup'],
    }
    const request = transport.request(url, options, (response) => {
      transfer.active = response
      resolve(response)
    })
    transfer.active = request
    request.on('error', (error) => {
      reject(transfer.failure ?? toConnectionError(error))
    })
    request.end()
  })
}

function toConnectionError(error: unknown): Error {
  if (error instanceof RemoteFetchError) return error
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new RemoteFetchError('The domain name could not be resolved')
  }
  return new RemoteFetchError('Could not reach the server')
}

function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (Number.isInteger(mb)) return `${mb} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function readBody(
  response: IncomingMessage,
  maxBytes: number,
  transfer: Transfer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      response.destroy()
      reject(transfer.failure ?? error)
    }
    response.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        fail(new RemoteFetchError(`The file is larger than ${formatLimit(maxBytes)}`))
        return
      }
      chunks.push(chunk)
    })
    response.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, total))
    })
    response.on('error', (error) => fail(toConnectionError(error)))
    response.on('close', () => fail(new RemoteFetchError('The download was interrupted')))
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Downloads a public http(s) file with SSRF protections: scheme, port and
 * credential checks, a connect-time address check on every hop, manual
 * redirect validation, a size cap and an overall deadline.
 */
export async function fetchRemoteFile(
  url: string,
  options: FetchRemoteFileOptions = {},
): Promise<RemoteFile> {
  const maxBytes = options.maxBytes ?? MAX_SIZE_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false

  const transfer: Transfer = {}
  const timer = setTimeout(
    () => abortTransfer(transfer, new RemoteFetchError(TIMEOUT_MESSAGE)),
    timeoutMs,
  )
  try {
    let current = parseRemoteUrl(url, allowPrivateNetwork)
    for (let redirects = 0; ; redirects++) {
      const response = await sendRequest(current, allowPrivateNetwork, transfer)
      const status = response.statusCode ?? 0
      const location = response.headers.location

      if (REDIRECT_STATUSES.has(status) && location) {
        response.destroy()
        if (redirects >= maxRedirects) {
          throw new RemoteFetchError(REDIRECT_LIMIT_MESSAGE)
        }
        current = parseRemoteUrl(new URL(location, current).href, allowPrivateNetwork)
        continue
      }

      if (status < 200 || status >= 300) {
        response.destroy()
        throw new RemoteFetchError(httpStatusMessage(status, current.hostname))
      }

      const declared = Number(response.headers['content-length'])
      if (response.headers['content-length'] !== undefined && declared > maxBytes) {
        response.destroy()
        throw new RemoteFetchError(`The file is larger than ${formatLimit(maxBytes)}`)
      }

      const bytes = await readBody(response, maxBytes, transfer)
      const mimeType = sniffMimeType(bytes)
      const contentDisposition = response.headers['content-disposition'] ?? null
      const contentType = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() || null
      return {
        bytes,
        contentType,
        filename: deriveFilename({
          url: current.href,
          contentDisposition,
          mimeType,
        }),
        finalUrl: current.href,
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** True when the bytes look like an HTML page (a link to a web page, not a file). */
export function looksLikeHtml(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 512).toString('latin1').trimStart().toLowerCase()
  return head.startsWith('<!doctype html') || /<html[\s>]/.test(head)
}

/** Explains why the downloaded bytes are not a supported file. */
export function unsupportedDownloadMessage(remote: Pick<RemoteFile, 'bytes' | 'contentType'>): string {
  const declared = remote.contentType ?? ''
  if (declared === 'text/html' || declared === 'application/xhtml+xml' || looksLikeHtml(remote.bytes)) {
    return WEB_PAGE_MESSAGE
  }
  if (declared && !declared.startsWith('image/') && declared !== 'application/pdf') {
    return `The link returned a file of type ${declared}, not an image or PDF. Use a direct image URL.`
  }
  return UNSUPPORTED_FILE_MESSAGE
}

export async function uploadAssetFromUrl(
  input: {
    organizationId: string
    originSiteId?: string
    url: string
    altText?: string
    filename?: string
    actorId: string | null
    /** Records the URL so later imports of the same image reuse this asset. */
    sourceUrl?: string
  },
  deps: { fetch?: typeof fetchRemoteFile } = {},
): Promise<Asset> {
  const download = deps.fetch ?? fetchRemoteFile
  const remote = await download(input.url)
  // The bytes decide the type: a declared Content-Type is not trusted.
  const mimeType = sniffMimeType(remote.bytes)
  if (!mimeType) {
    throw new AssetValidationError(unsupportedDownloadMessage(remote))
  }
  const filename =
    cleanFilename(input.filename, mimeType) ??
    cleanFilename(remote.filename, mimeType) ??
    withMimeExtension('download', mimeType)

  return uploadAsset({
    organizationId: input.organizationId,
    originSiteId: input.originSiteId,
    file: { buffer: remote.bytes, filename, mimeType },
    actorId: input.actorId,
    altText: input.altText,
    sourceUrl: input.sourceUrl,
  })
}
