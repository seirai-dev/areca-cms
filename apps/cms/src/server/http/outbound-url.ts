import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

import { AppError } from './app-error'

export type ResolveHost = (hostname: string) => Promise<string[]>

export class UnsafeOutboundUrlError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeOutboundUrlError'
  }
}

export const resolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export function assertSecureServiceUrl(
  rawUrl: string,
  allowInsecureHttp = false,
) {
  const url = new URL(rawUrl)
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('Service URL must not contain credentials')
  }
  if (url.protocol === 'https:') return url
  if (
    url.protocol === 'http:' &&
    (allowInsecureHttp || isLocalHostname(url.hostname))
  ) {
    return url
  }
  throw new UnsafeOutboundUrlError('Service URL must use HTTPS')
}

export async function assertSafeHealthCheckUrl(
  rawUrl: string,
  options: {
    resolve?: ResolveHost
    allowPrivateNetwork?: boolean
    allowInsecureHttp?: boolean
  } = {},
) {
  return (await resolveSafeHealthCheckUrl(rawUrl, options)).url
}

export async function resolveSafeHealthCheckUrl(
  rawUrl: string,
  options: {
    resolve?: ResolveHost
    allowPrivateNetwork?: boolean
    allowInsecureHttp?: boolean
  } = {},
) {
  const url = assertSecureServiceUrl(rawUrl, options.allowInsecureHttp)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeOutboundUrlError('Unsupported health-check protocol')
  }
  if (options.allowPrivateNetwork) return { url, addresses: [] }

  const hostname = unbracketHostname(url.hostname)
  const addresses = isIP(hostname)
    ? [hostname]
    : await (options.resolve ?? resolveHost)(hostname)
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedAddress)) {
    throw new UnsafeOutboundUrlError(
      'Health-check URL resolves to a private or reserved address',
    )
  }
  return { url, addresses }
}

function isLocalHostname(hostname: string) {
  const normalized = unbracketHostname(hostname)
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1'
  )
}

function unbracketHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

export function isPrivateOrReservedAddress(address: string) {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number)
    const [a, b] = parts
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    )
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    if (normalized.startsWith('::ffff:')) {
      return isPrivateOrReservedAddress(normalized.slice(7))
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    )
  }
  return true
}
