import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ClientRequest, RequestOptions } from 'node:http'
import { isIP } from 'node:net'

import { AppError } from '#/server/http/app-error'
import { isPublicAddress } from '#/server/http/ip-address'
import { m } from '#/paraglide/messages'

import { AssetValidationError, MAX_SIZE_BYTES, uploadAsset } from './index'
import type { Asset } from './index'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 3
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443])
const USER_AGENT = 'ArecaCMS/1.0 (+asset-import)'
const ACCEPT = 'image/*,application/pdf'
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

// Compatibility exports use the English catalog; request errors resolve their
// locale at the point of use below.
export const PRIVATE_ADDRESS_MESSAGE = m.server_remote_private_address(
  {},
  { locale: 'en' },
)
export const UNSUPPORTED_SCHEME_MESSAGE = m.server_remote_unsupported_scheme(
  {},
  { locale: 'en' },
)
export const TIMEOUT_MESSAGE = m.server_remote_timeout({}, { locale: 'en' })
export const REDIRECT_LIMIT_MESSAGE = m.server_remote_redirect_limit(
  {},
  { locale: 'en' },
)
export const UNSUPPORTED_FILE_MESSAGE = m.server_remote_unsupported_file(
  {},
  { locale: 'en' },
)
export const WEB_PAGE_MESSAGE = m.server_remote_web_page({}, { locale: 'en' })

/** Message for a non-2xx answer. Names the host and status so the agent can tell the user what happened. */
export function httpStatusMessage(status: number, host: string): string {
  if (status >= 400 && status < 500) {
    return m.server_remote_http_client_error({ status: String(status), host })
  }
  if (status >= 500) {
    return m.server_remote_http_server_error({ status: String(status), host })
  }
  return m.server_remote_http_client_error({ status: String(status), host })
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
// Media type and filename helpers
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

/** Detects the media type from the file's leading bytes. Null when not a supported type. */
export function sniffMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
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
  if (
    bytes.length >= 5 &&
    bytes.subarray(0, 5).toString('latin1') === '%PDF-'
  ) {
    return 'application/pdf'
  }
  return null
}

const EXTENSIONS_BY_MIME: Record<
  string,
  { preferred: string; accepted: string[] }
> = {
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

export function cleanFilename(
  raw: string | null | undefined,
  mimeType: string | null,
): string | undefined {
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
    ? cleanFilename(
        filenameFromContentDisposition(input.contentDisposition),
        mimeType,
      )
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
    throw new RemoteFetchError(m.server_remote_invalid_address())
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RemoteFetchError(m.server_remote_unsupported_scheme())
  }
  if (url.username || url.password) {
    throw new RemoteFetchError(m.server_remote_credentials_unsupported())
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80
  if (!ALLOWED_PORTS.has(port)) {
    throw new RemoteFetchError(
      m.server_remote_port_not_allowed({ port: String(port) }),
    )
  }
  const host = unbracket(url.hostname)
  if (!host) throw new RemoteFetchError(m.server_remote_invalid_address())
  if (isIP(host) && !allowPrivateNetwork && !isPublicAddress(host)) {
    throw new RemoteFetchError(m.server_remote_private_address())
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
        callback(new RemoteFetchError(m.server_remote_domain_unresolved()))
        return
      }
      if (
        !allowPrivateNetwork &&
        records.some((r) => !isPublicAddress(r.address))
      ) {
        callback(new RemoteFetchError(m.server_remote_private_address()))
        return
      }
      const family =
        options.family === 4 || options.family === 6
          ? options.family
          : undefined
      const pool = family ? records.filter((r) => r.family === family) : records
      if (options.all) {
        callback(null, pool)
        return
      }
      const chosen = pool.at(0)
      if (!chosen) {
        callback(new RemoteFetchError(m.server_remote_domain_unresolved()))
        return
      }
      callback(null, chosen.address, chosen.family)
    })
  }
}

function dnsFailureMessage(error: NodeJS.ErrnoException): string {
  if (
    error.code === 'ENOTFOUND' ||
    error.code === 'EAI_AGAIN' ||
    error.code === 'ENODATA'
  ) {
    return m.server_remote_domain_unresolved()
  }
  return m.server_remote_unreachable()
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
    return new RemoteFetchError(m.server_remote_domain_unresolved())
  }
  return new RemoteFetchError(m.server_remote_unreachable())
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
        fail(
          new RemoteFetchError(
            m.server_remote_file_too_large({ limit: formatLimit(maxBytes) }),
          ),
        )
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
    response.on('close', () =>
      fail(new RemoteFetchError(m.server_remote_interrupted())),
    )
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
    () =>
      abortTransfer(transfer, new RemoteFetchError(m.server_remote_timeout())),
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
          throw new RemoteFetchError(m.server_remote_redirect_limit())
        }
        current = parseRemoteUrl(
          new URL(location, current).href,
          allowPrivateNetwork,
        )
        continue
      }

      if (status < 200 || status >= 300) {
        response.destroy()
        throw new RemoteFetchError(httpStatusMessage(status, current.hostname))
      }

      const declared = Number(response.headers['content-length'])
      if (
        response.headers['content-length'] !== undefined &&
        declared > maxBytes
      ) {
        response.destroy()
        throw new RemoteFetchError(
          m.server_remote_file_too_large({ limit: formatLimit(maxBytes) }),
        )
      }

      const bytes = await readBody(response, maxBytes, transfer)
      const mimeType = sniffMimeType(bytes)
      const contentDisposition = response.headers['content-disposition'] ?? null
      const contentType =
        response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ||
        null
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
  const head = bytes
    .subarray(0, 512)
    .toString('latin1')
    .trimStart()
    .toLowerCase()
  return head.startsWith('<!doctype html') || /<html[\s>]/.test(head)
}

/** Explains why the downloaded bytes are not a supported file. */
export function unsupportedDownloadMessage(
  remote: Pick<RemoteFile, 'bytes' | 'contentType'>,
): string {
  const declared = remote.contentType ?? ''
  if (
    declared === 'text/html' ||
    declared === 'application/xhtml+xml' ||
    looksLikeHtml(remote.bytes)
  ) {
    return m.server_remote_web_page()
  }
  if (
    declared &&
    !declared.startsWith('image/') &&
    declared !== 'application/pdf'
  ) {
    return m.server_remote_wrong_mime({ mimeType: declared })
  }
  return m.server_remote_unsupported_file()
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
